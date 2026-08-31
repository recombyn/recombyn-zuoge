import { useRef, useState, memo } from 'react';
import { useDispatch } from '@/store';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  createImportJob,
  getImportJob,
  importImage,
  type ImportJobResult,
  type ImportSourceType,
} from '@/service/import';
import { healthCheck } from '@/service/health';
import { getHttpErrorMessage, getHttpStatus } from '@/service/client';
import { message } from '@/components/base';
import ImportFileDialog, {
  IMPORT_ACCEPT,
  type ImportFileKind,
} from '@/components/home/ImportFileDialog';
import type { HomeAgentSubmitPayload } from '@/components/home/HomeAgentComposer';
import HomeTopBar from '@/components/layout/HomeTopBar';
import { HomeSidebar, HomeTemplateList, useHomeNav } from '@/components/layout/HomeBody';
import {
  homeRailWidthPx,
  useHomeRailExpanded,
} from '@/components/layout/useHomeRailExpanded';
import { store } from '@/store';
import { importDocument } from '@/store/modules/editor';
import { parseAndValidateSceneJson } from '@/components/rcb/sceneNode';
import { useGoEditor } from '@/utils/goEditor';
import { publishEditorProjectLocally } from '@/utils/editorProjectNavigation';
import {
  buildPlazaStyleSkillChip,
  type OfficialCaseMeta,
} from '@/utils/officialCases';
import { cn } from '@/utils/classnames';

function detectImportSourceType(file: File): ImportSourceType | null {
  const name = file.name.toLowerCase();
  const type = file.type;
  if (/\.(psd|xd|rp|fig)$/i.test(name) || /photoshop|x-psd/i.test(type)) return null;
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)) return 'image';
  if (type.startsWith('image/')) return 'image';
  return null;
}

function fileForm(file: File, extra?: Record<string, string>): FormData {
  const data = new FormData();
  data.append('file', file);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) data.append(k, v);
  }
  return data;
}

async function importSync(file: File, _sourceType: ImportSourceType): Promise<ImportJobResult> {
  const res: any = await importImage(fileForm(file));
  return {
    job_id: res?.job_id ?? null,
    status: (res?.status as ImportJobResult['status']) || 'done',
    document: res?.document ?? null,
    meta: res?.meta ?? null,
    error: res?.error ?? null,
    progress: 100,
  };
}

async function importViaJob(
  file: File,
  sourceType: ImportSourceType,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (status: ImportJobResult) => void;
    allowSyncFallback?: boolean;
  }
): Promise<ImportJobResult> {
  const intervalMs = options?.intervalMs ?? 1200;
  const timeoutMs = options?.timeoutMs ?? 180000;
  const allowSyncFallback = options?.allowSyncFallback !== false;

  let canQueue = false;
  try {
    const health = await healthCheck();
    canQueue = Boolean(health?.checks?.redis && health?.checks?.worker);
  } catch {
    canQueue = false;
  }

  if (allowSyncFallback && !canQueue) {
    options?.onProgress?.({ job_id: null, status: 'processing', progress: 20 });
    return importSync(file, sourceType);
  }

  let created: { job_id: string; status: 'queued' };
  try {
    created = await createImportJob(fileForm(file, { source_type: sourceType }));
  } catch (err) {
    if (!allowSyncFallback) throw err;
    options?.onProgress?.({ job_id: null, status: 'processing', progress: 20 });
    return importSync(file, sourceType);
  }

  const jobId = created.job_id;
  const started = Date.now();
  options?.onProgress?.({ job_id: jobId, status: 'queued', progress: 0 });

  while (Date.now() - started < timeoutMs) {
    let status: ImportJobResult;
    try {
      status = await getImportJob(jobId);
    } catch (err) {
      if (!allowSyncFallback) throw err;
      return importSync(file, sourceType);
    }
    options?.onProgress?.(status);
    if (status.status === 'done' || status.status === 'failed') return status;
    if (allowSyncFallback && status.status === 'queued' && Date.now() - started > 8000) {
      return importSync(file, sourceType);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (allowSyncFallback) return importSync(file, sourceType);
  throw new Error('Import job timed out');
}

function currentProjectId(): string | undefined {
  const id = (store.getState() as any)?.editor?.currentId;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

function mapAgentBootAttachments(attachments: HomeAgentSubmitPayload['attachments']) {
  return attachments
    .filter((a) => a.dataUrl || a.thumbUrl)
    .map((a) => {
      const ref = String(a.dataUrl || '').trim();
      const remote = ref.startsWith('http://') || ref.startsWith('https://');
      return {
        key: a.key,
        label: a.label,
        kind: 'attachment' as const,
        dataUrl: a.dataUrl,
        thumbUrl: remote ? undefined : a.thumbUrl,
        uploadKey: a.uploadKey,
      };
    });
}

function resolveImportEmptyMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  _sourceType: ImportSourceType,
  _warnings: string[]
): string {
  return t('home.importImageEmpty');
}

function showImportWarningsIfAny(
  t: (key: string, opts?: Record<string, unknown>) => string,
  warnings: string[]
) {
  if (warnings.some((w) => /raster-fallback|OCR produced no text/i.test(w))) {
    message.warning(t('home.importRasterFallback'), 6);
  }
}

function HomePage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const goEditor = useGoEditor();
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { nav, setNav, query, importing, setImporting, importingName, setImportingName } =
    useHomeNav();
  const [railExpanded] = useHomeRailExpanded();
  const railPad = homeRailWidthPx(railExpanded);

  const handleCreate = () => {
    goEditor({ createNew: true });
  };

  const handleAgentSubmit = (payload: HomeAgentSubmitPayload) => {
    const prompt = payload.prompt.trim();
    if (!prompt) return;
    goEditor({
      createNew: true,
      fromHomeAgent: true,
      homeAgentBoot: {
        prompt,
        autoSubmit: true,
        modelId: payload.modelId ?? null,
        interactionMode: payload.interactionMode ?? null,
        imageAspectRatio: payload.imageAspectRatio ?? null,
        scene: payload.scene ?? null,
        attachments: mapAgentBootAttachments(payload.attachments),
      },
    });
  };

  const handleOpenCase = (meta: OfficialCaseMeta) => {
    goEditor({
      createNew: true,
      fromHomeAgent: true,
      homeAgentBoot: {
        prompt: '',
        autoSubmit: false,
        scene: meta.category,
        contexts: [buildPlazaStyleSkillChip(meta, t)],
      },
    });
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const validation = parseAndValidateSceneJson(text);
      if (validation.valid === false) {
        console.error('Import JSON validation error:', validation.error);
        message.error(t('home.importJsonInvalid'));
        return;
      }
      const importedName = file.name.replace(/\.json$/i, '');
      dispatch(
        importDocument({
          name: importedName,
          document: validation.data,
          source: 'import',
          dirty: true,
        })
      );
      message.success(t('home.importSuccess'));
      const id = (store.getState() as any).editor?.currentId;
      const importedDoc = (store.getState() as any).editor?.document;
      if (id && importedDoc) {
        await publishEditorProjectLocally({
          projectId: id,
          name: importedName,
          document: importedDoc,
          navigate,
        });
      }
    } catch (error) {
      console.error('Import JSON error:', error);
      message.error(t('home.importJsonFailed'));
    } finally {
      event.target.value = '';
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '');
    const sourceType = detectImportSourceType(file);
    if (!sourceType) {
      message.error(t('home.importUnsupported'));
      event.target.value = '';
      return;
    }

    setImportingName(name);
    setImporting(true);
    message.loading(t('home.importing'));
    try {
      const res = await importViaJob(file, sourceType);
      if (res.status === 'failed') {
        message.error(res.error || t('home.importFailed'));
        return;
      }
      const document = res.document as any;
      if (!document) {
        message.error(t('home.importNoDocument'));
        return;
      }
      const children = document?.deltaSetLike?.ROOT?.children;
      const warnings = res.meta?.warnings || [];
      if (!children?.length) {
        message.error(resolveImportEmptyMessage(t, sourceType, warnings), 8);
        return;
      }
      dispatch(importDocument({ name, document, source: 'import' }));
      showImportWarningsIfAny(t, warnings);
      message.success(t('home.importSuccess'));
      goEditor({ projectId: currentProjectId() });
    } catch (err: unknown) {
      const status = getHttpStatus(err);
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (status === 502 || status === 504 || code === 'ERR_NETWORK' || code === 'ECONNABORTED') {
        message.error(t('home.importApiDown'));
      } else {
        message.error(getHttpErrorMessage(err, t('home.importFailed')));
      }
    } finally {
      setImporting(false);
      setImportingName('');
      event.target.value = '';
    }
  };

  const openFilePicker = (kind: ImportFileKind) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = IMPORT_ACCEPT[kind];
    input.value = '';
    input.click();
  };

  return (
    <div
      className={cn(
        'relative h-full overflow-hidden',
        'rcb-home-hero-canvas'
      )}
    >
      <HomeSidebar
        nav={nav}
        setNav={setNav}
        importing={importing}
        onCreate={handleCreate}
      />
      <div
        className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden transition-[padding] duration-200 ease-out md:pl-[var(--home-rail-w)]"
        style={{ ['--home-rail-w' as string]: `${railPad}px` }}
      >
        <HomeTopBar nav={nav} setNav={setNav} />
        <HomeTemplateList
          nav={nav}
          setNav={setNav}
          query={query}
          importing={importing}
          importingName={importingName}
          onCreate={handleCreate}
          onAgentSubmit={handleAgentSubmit}
          onOpenCase={handleOpenCase}
        />
      </div>
      <ImportFileDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onConfirm={openFilePicker}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportJson}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_ACCEPT.image}
        className="hidden"
        onChange={handleImportFile}
      />
    </div>
  );
}

export default memo(HomePage);
