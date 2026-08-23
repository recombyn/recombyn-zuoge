/**
 * Shared k6 config — Gate B load scenarios.
 *
 * Env:
 *   BASE_URL    API origin (default http://127.0.0.1:8000)
 *   PERF_TOKEN  Bearer for authenticated scenarios
 */
export const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
export const TOKEN = (__ENV.PERF_TOKEN || '').trim();

export function authHeaders() {
  const h = { Accept: 'application/json' };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}
