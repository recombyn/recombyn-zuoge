/** Extract / compress audio & video via FFmpeg.wasm (singleton). */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
/** Package export — keep as URL (not blob) so worker's relative imports resolve. */
import ffmpegWorkerURL from '@ffmpeg/ffmpeg/worker?url';

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

/** Soft wire budgets — never reject; only recompress when over. */
export const MEDIA_VIDEO_TARGET_BYTES = 40 * 1024 * 1024;
export const MEDIA_AUDIO_TARGET_BYTES = 8 * 1024 * 1024;

/** Local static files under `apps/web/public/ffmpeg` (esm, from `@ffmpeg/core`). */
function coreBaseURL(): string {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}ffmpeg`;
}

async function loadFfmpegOnce(): Promise<FFmpeg> {
  const ff = new FFmpeg();
  const base = coreBaseURL();
  // Must use **esm** core: module worker does `import(coreURL).default`.
  await ff.load({
    classWorkerURL: ffmpegWorkerURL,
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ff;
  return ff;
}

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    try {
      return await loadFfmpegOnce();
    } catch (err) {
      ffmpegInstance = null;
      throw err;
    }
  })();

  try {
    return await ffmpegLoading;
  } finally {
    ffmpegLoading = null;
  }
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : 'mp4';
}

function baseName(name: string): string {
  return String(name || 'media').replace(/\.[^.]+$/, '') || 'media';
}

function isAudioFile(file: File): boolean {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name || '');
}

export type ExportVideoAudioOpts = {
  file: File | Blob;
  /** Clip start (seconds). Prefer input-seek for speed. */
  trimStart?: number;
  /** Clip end (seconds, absolute). */
  trimEnd?: number;
  /** kbps — lower is faster. Default 128. */
  bitrate?: number;
  /** Sample rate Hz. Default 44100. */
  sampleRate?: number;
};

/** Video/audio file → MP3 blob (`-vn -c:a libmp3lame`). */
export async function exportVideoAudio(
  opts: ExportVideoAudioOpts
): Promise<{ blob: Blob; ext: 'mp3' }> {
  const ffmpeg = await getFFmpeg();
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const srcName =
    opts.file instanceof File && opts.file.name
      ? opts.file.name
      : 'input.mp4';
  const inputName = `in_${id}.${extOf(srcName)}`;
  const outputName = `out_${id}.mp3`;

  await ffmpeg.writeFile(inputName, await fetchFile(opts.file));

  const bitrate = Math.max(64, Math.min(320, Number(opts.bitrate) || 128));
  const sampleRate = Number(opts.sampleRate) || 44100;
  const hasStart = Number.isFinite(opts.trimStart) && Number(opts.trimStart) > 0;
  const hasEnd = Number.isFinite(opts.trimEnd) && Number(opts.trimEnd) > 0;

  const args: string[] = [];
  if (hasStart) args.push('-ss', String(Number(opts.trimStart)));
  if (hasEnd) args.push('-to', String(Number(opts.trimEnd)));
  args.push(
    '-i',
    inputName,
    '-vn',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${bitrate}k`,
    '-ar',
    String(sampleRate),
    '-y',
    outputName
  );

  try {
    await ffmpeg.exec(args);
    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    if (!blob.size) throw new Error('empty mp3');
    return { blob, ext: 'mp3' };
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Soft-compress oversized audio for composer upload (MP3 ~128k).
 * Under target → original. Never rejects.
 */
export async function compressAudioFileForUpload(
  file: File,
  opts?: { targetBytes?: number; signal?: AbortSignal }
): Promise<File> {
  if (!isAudioFile(file)) return file;
  const target = Math.max(256 * 1024, opts?.targetBytes ?? MEDIA_AUDIO_TARGET_BYTES);
  const mime = String(file.type || '').toLowerCase();
  if (file.size <= target && (mime.includes('mpeg') || mime.includes('mp3'))) {
    return file;
  }
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  try {
    const { blob } = await exportVideoAudio({ file, bitrate: 128 });
    if (!blob.size || blob.size >= file.size * 0.95) return file;
    return new File([blob], `${baseName(file.name)}.mp3`, {
      type: 'audio/mpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/**
 * Soft-compress oversized video for composer upload (≤1280w, CRF 28, AAC).
 * Under target → original. Never rejects. First FFmpeg load may be slow.
 */
export async function compressVideoFileForUpload(
  file: File,
  opts?: { targetBytes?: number; signal?: AbortSignal }
): Promise<File> {
  if (!String(file.type || '').toLowerCase().startsWith('video/')) return file;
  const target = Math.max(1024 * 1024, opts?.targetBytes ?? MEDIA_VIDEO_TARGET_BYTES);
  if (file.size <= target) return file;
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  try {
    const ffmpeg = await getFFmpeg();
    if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const inputName = `vin_${id}.${extOf(file.name || 'input.mp4')}`;
    const outputName = `vout_${id}.mp4`;
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    try {
      await ffmpeg.exec([
        '-i',
        inputName,
        '-vf',
        "scale='min(1280,iw)':-2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '28',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-y',
        outputName,
      ]);
      const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      const blob = new Blob([bytes], { type: 'video/mp4' });
      if (!blob.size || blob.size >= file.size * 0.95) return file;
      return new File([blob], `${baseName(file.name)}.mp4`, {
        type: 'video/mp4',
        lastModified: Date.now(),
      });
    } finally {
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        /* ignore */
      }
      try {
        await ffmpeg.deleteFile(outputName);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return file;
  }
}
