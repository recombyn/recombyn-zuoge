/**
 * Gate B — smoke: root + health + metrics must be green.
 *
 *   k6 run perf/k6/smoke.js
 *   BASE_URL=http://127.0.0.1:8000 k6 run perf/k6/smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './lib/config.js';

export const options = {
  vus: 2,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Split: /health may wait on Redis/worker; root+metrics stay reasonable on local Windows.
    'http_req_duration{name:root}': ['p(95)<3000'],
    // /metrics may refresh dep gauges (throttled); allow cold-scrape cost.
    'http_req_duration{name:metrics}': ['p(95)<3000'],
    'http_req_duration{name:health}': ['p(95)<8000'],
  },
};

export default function () {
  const root = http.get(`${BASE_URL}/`, { tags: { name: 'root' } });
  check(root, {
    'root 200': (r) => r.status === 200,
    'root service': (r) => String(r.body || '').includes('recombyn-api'),
  });

  const health = http.get(`${BASE_URL}/api/v1/health`, { tags: { name: 'health' } });
  check(health, {
    'health 200': (r) => r.status === 200,
    'health has checks': (r) => String(r.body || '').includes('checks'),
  });

  const metrics = http.get(`${BASE_URL}/metrics`, { tags: { name: 'metrics' } });
  check(metrics, {
    'metrics 200': (r) => r.status === 200,
    'metrics prometheus': (r) =>
      String(r.body || '').includes('recombyn_dependency') ||
      String(r.body || '').includes('http_request'),
  });

  sleep(0.5);
}
