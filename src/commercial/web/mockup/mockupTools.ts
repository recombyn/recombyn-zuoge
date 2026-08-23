/**
 * Closed-source mockup API client — lives under src/private/ (not committed to GitHub).
 */

import { getApiBaseUrl } from '@/utils/apiBase';
import { getToken } from '@/utils/token';
import type { MockupRenderResult } from '@/service/mockupTools';

export async function renderMockup(
  image: string,
  templateId = 'demo-cylinder'
): Promise<MockupRenderResult> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const token = getToken();
  const res = await fetch(`${base}/api/v1/mockup/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ image, template_id: templateId }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = String(body?.detail || '');
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `mockup render failed (${res.status})`);
  }
  return (await res.json()) as MockupRenderResult;
}
