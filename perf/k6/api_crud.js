/**
 * Gate B — authenticated API read path (projects list / me).
 * Requires PERF_TOKEN.
 *
 *   PERF_TOKEN=... k6 run perf/k6/api_crud.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, TOKEN, authHeaders } from './lib/config.js';

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '40s', target: 15 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // Local MySQL + design load often lands 2–4s p95; fail on errors, not laptop latency.
    http_req_duration: ['p(95)<5000'],
    checks: ['rate>0.95'],
  },
};

export function setup() {
  if (!TOKEN) {
    throw new Error('PERF_TOKEN required for api_crud.js');
  }
  return { token: TOKEN };
}

export default function () {
  const h = authHeaders();

  const me = http.get(`${BASE_URL}/api/v1/auth/me`, { headers: h });
  check(me, {
    'me 200': (r) => r.status === 200,
  });

  const projects = http.get(`${BASE_URL}/api/v1/projects`, { headers: h });
  check(projects, {
    'projects ok': (r) => r.status === 200 || r.status === 404,
  });

  sleep(0.3);
}
