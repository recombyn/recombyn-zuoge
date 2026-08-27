import { uploadFileViaJob, dispatchUploadJobCreated } from '@/service/uploadJobs';
import { request } from '@/utils/request';

export type UploadedFileItem = {
  url: string;
  key?: string;
  mime?: string;
  name?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
};

export async function uploadUserFile(
  file: File,
  opts?: {
    signal?: AbortSignal;
    onProgress?: (pct: number) => void;
    onJobCreated?: (jobId: string) => void;
    jobId?: string;
    dispatch?: (action: unknown) => unknown;
    nodeId?: string;
  }
): Promise<UploadedFileItem> {
  const nodeId = String(opts?.nodeId || '').trim();
  const onJobCreated =
    opts?.onJobCreated ??
    (opts?.dispatch && nodeId
      ? (jobId: string) => dispatchUploadJobCreated(opts.dispatch!, nodeId, jobId)
      : undefined);

  return uploadFileViaJob(file, {
    signal: opts?.signal,
    jobId: opts?.jobId,
    onProgress: opts?.onProgress,
    onJobCreated,
  });
}

export const deleteUploadedFile = (encodedKeyPath: string) =>
  request<{ ok: boolean }>({
    url: `/api/v1/uploads/files/${encodedKeyPath}`,
    method: 'delete',
  });
