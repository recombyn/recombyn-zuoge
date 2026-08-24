import type { GenerateAudioResult, GenerateVideoResult } from '@/service/chat';

export function pickVideoUrl(res: GenerateVideoResult): string {
  const fromVideos =
    Array.isArray(res?.videos) && res.videos.find((u) => String(u || '').trim());
  if (fromVideos) return String(fromVideos).trim();
  const fromAssets =
    Array.isArray(res?.assets) &&
    res.assets.map((a) => String(a?.url || '').trim()).find(Boolean);
  return fromAssets ? String(fromAssets).trim() : '';
}

export function pickAudioUrl(res: GenerateAudioResult): string {
  const fromAudios =
    Array.isArray(res?.audios) && res.audios.find((u) => String(u || '').trim());
  if (fromAudios) return String(fromAudios).trim();
  const fromAssets =
    Array.isArray(res?.assets) &&
    res.assets.map((a) => String(a?.url || '').trim()).find(Boolean);
  return fromAssets ? String(fromAssets).trim() : '';
}

export function probeAudioDuration(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const done = (value: number | null) => {
      audio.removeAttribute('src');
      audio.load();
      resolve(value);
    };
    audio.onloadedmetadata = () => {
      const d = Number(audio.duration);
      done(Number.isFinite(d) && d > 0 ? d : null);
    };
    audio.onerror = () => done(null);
    audio.src = src;
    window.setTimeout(() => done(null), 4000);
  });
}
