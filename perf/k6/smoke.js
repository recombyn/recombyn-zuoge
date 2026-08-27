/**
 * Gate B — API health smoke + optional soak (sustained load).
 *
 * Smoke (default):
 *   k6 run perf/k6/smoke.js
 *
 * Soak:
 *   k6 run -e K6_SOAK=1 perf/k6/smoke.js
 *   k6 run -e K6_SOAK=1 -e K6_SOAK_DURATION=10m perf/k6/smoke.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './lib/config.js';

const SOAK = __ENV.K6_SOAK === '1' || __ENV.K6_MODE === 'soak';
const SOAK_DURATION = __ENV.K6_SOAK_DURATION || '5m';

export const options = SOAK
  ? {
      vus: 3,
      duration: SOAK_DURATION,
      thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<1200', 'p(99)<3000'],
        checks: ['rate>0.98'],
      },
    }
  : {
      vus: 2,
      duration: '30s',
      thresholds: {
        http_req_failed: ['rate<0.01'],
        checks: ['rate>0.99'],
        'http_req_duration{name:root}': ['p(95)<3000'],
        'http_req_duration{name:metrics}': ['p(95)<3000'],
        'http_req_duration{name:health}': ['p(95)<8000'],
      },
    };

export default function () {
  if (SOAK) {
    const health = http.get(`${BASE_URL}/api/v1/health`);
    check(health, { 'health 200': (r) => r.status === 200 });

    const metrics = http.get(`${BASE_URL}/metrics`);
    check(metrics, {
      'metrics 200': (r) => r.status === 200,
      'metrics body': (r) => String(r.body || '').length > 20,
    });

    sleep(1);
    return;
  }

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
