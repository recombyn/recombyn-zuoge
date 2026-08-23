import { apiClient } from '@/service/client';
import { request } from '@/utils/request';

export type ImportSourceType = 'image';

export type ImportJobStatus = 'queued' | 'processing' | 'done' | 'failed';

export type ImportJobResult = {
  job_id: string | null;
  status: ImportJobStatus;
  progress?: number;
  document?: Record<string, unknown> | null;
  meta?: {
    source_type?: ImportSourceType;
    page_count?: number;
    page_images?: string[];
    object_urls?: string[];
    palette?: string[];
    engines?: string[];
    warnings?: string[];
  } | null;
  error?: string | null;
};

export const importImage = (data: FormData) =>
  request({
    url: '/api/v1/import/image',
    method: 'post',
    data,
    timeout: 180000,
  });

export const createImportJob = (data: FormData) =>
  request<{ job_id: string; status: 'queued' }>({
    url: '/api/v1/import/jobs',
    method: 'post',
    data,
    timeout: 120000,
  });

export const getImportJob = (jobId: string) =>
  apiClient.importJobsGetImportJob({
    params: { job_id: jobId },
  }) as Promise<ImportJobResult>;
