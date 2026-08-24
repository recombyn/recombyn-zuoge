export type ComposerModelsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Why the composer send button is disabled (shown in tooltip). */
export function composerSendDisabledReason(opts: {
  t: (key: string) => string;
  attachmentsUploading?: boolean;
  hasContent: boolean;
  apiAvailable: boolean | null;
  modelsStatus: ComposerModelsStatus;
  /** Canvas generators: also block while the models catalog is still loading. */
  blockWhileModelsLoading?: boolean;
}): string | undefined {
  const { t, attachmentsUploading, hasContent, apiAvailable, modelsStatus, blockWhileModelsLoading } =
    opts;
  if (attachmentsUploading) return t('agent.attachWaitUpload');
  if (!hasContent) return t('agent.sendNeedContent');
  if (
    blockWhileModelsLoading &&
    (modelsStatus === 'loading' || modelsStatus === 'idle')
  ) {
    return t('agent.modelsUnavailable');
  }
  if (modelsStatus === 'error') return t('agent.modelsLoadFailed');
  if (apiAvailable === false) return t('agent.modelsUnavailable');
  return undefined;
}

/** Whether a canvas / agent composer may submit a generation request. */
export function composerCanSend(opts: {
  hasContent: boolean;
  sending?: boolean;
  disabled?: boolean;
  attachmentsUploading?: boolean;
  apiAvailable: boolean | null;
  modelsStatus: ComposerModelsStatus;
}): boolean {
  if (opts.disabled || opts.sending) return false;
  if (opts.attachmentsUploading) return false;
  if (!opts.hasContent) return false;
  if (opts.modelsStatus === 'loading' || opts.modelsStatus === 'idle') return false;
  if (modelsStatusIsError(opts.modelsStatus)) return false;
  if (opts.apiAvailable === false) return false;
  return true;
}

function modelsStatusIsError(status: ComposerModelsStatus): boolean {
  return status === 'error';
}
