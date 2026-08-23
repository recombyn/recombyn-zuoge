/**
 * Gate B — soak: sustained health + metrics under light load.
 *
 *   k6 run perf/k6/soak.js
 *   K6_SOAK_DURATION=10m k6 run perf/k6/soak.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './lib/config.js';

const DURATION = __ENV.K6_SOAK_DURATION || '5m';

export const options = {
  vus: 3,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1200', 'p(99)<3000'],
    checks: ['rate>0.98'],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/api/v1/health`);
  check(health, { 'health 200': (r) => r.status === 200 });

  const metrics = http.get(`${BASE_URL}/metrics`);
  check(metrics, {
    'metrics 200': (r) => r.status === 200,
    'metrics body': (r) => String(r.body || '').length > 20,
  });

  sleep(1);
}
