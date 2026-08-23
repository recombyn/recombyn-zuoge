/**
 * Health check API.
 */

import { apiClient } from '@/service/client';

export type HealthResponse = {
  status: 'ok' | 'degraded' | string;
  checks?: {
    api?: boolean;
    redis?: boolean;
    worker?: boolean;
    ocr?: boolean;
    use_vision?: boolean;
    s3?: boolean;
  };
};

export const healthCheck = () => apiClient.healthHealth() as Promise<HealthResponse>;
