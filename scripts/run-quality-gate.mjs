/**
 * Unified quality gate — Gate A (correctness) + optional Gate B (load).
 *
 *   npm run test:gate          # A: web + api + e2e (+ agent stress if token)
 *   npm run test:gate:a        # correctness only
 *   npm run test:gate:b        # k6 smoke/api/collab (needs k6 + API up)
 *   npm run test:gate -- --skip-e2e --skip-agent
 *
 * Prefers live web/API on 127.0.0.1. For Gate B under load, restart API with:
 *   RATE_LIMIT_ENABLED=false
 *
 * Env: E2E_BASE_URL, E2E_TOKEN / .tmp-token.txt, GATE_SKIP_*, BASE_URL
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function hasFlag(name) {
  return argv.includes(name);
}

function flagValue(name) {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : '';
}

const gateRaw = (flagValue('--gate') || '').toLowerCase();
const wantA = !gateRaw || gateRaw === 'a' || gateRaw === 'full' || gateRaw === 'all';
const wantB = gateRaw === 'b' || gateRaw === 'full' || gateRaw === 'all';
const skipE2e = hasFlag('--skip-e2e') || process.env.GATE_SKIP_E2E === '1';
const skipAgent = hasFlag('--skip-agent') || process.env.GATE_SKIP_AGENT === '1';
const skipK6 = hasFlag('--skip-k6') || process.env.GATE_SKIP_K6 === '1';
const skipFunctional =
  hasFlag('--skip-functional') || process.env.GATE_SKIP_FUNCTIONAL === '1';

function readToken() {
  const env = (process.env.E2E_TOKEN || process.env.STRESS_TOKEN || process.env.PERF_TOKEN || '').trim();
  if (env) return env;
  const p = path.join(root, '.tmp-token.txt');
  if (!existsSync(p)) return '';
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

async function run(label, command, args, opts = {}) {
  console.log(`\n══ ${label} ══\n$ ${command} ${args.join(' ')}\n`);
  const code = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || root,
      stdio: 'inherit',
      env: { ...process.env, ...(opts.env || {}) },
      shell: opts.shell ?? process.platform === 'win32',
    });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  if (code !== 0) {
    console.error(`\n✘ ${label} failed (exit ${code})`);
    process.exit(code);
  }
  console.log(`\n✓ ${label}`);
}

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

const token = readToken();
const baseWeb = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const baseApi = (process.env.BASE_URL || process.env.STRESS_API || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);

console.log(
  `[gate] A=${wantA} B=${wantB} web=${baseWeb} api=${baseApi} token=${token ? 'yes' : 'no'}`
);

if (wantA) {
  await run('Gate A · web unit', 'npm', ['run', 'test:web']);
  await run('Gate A · api unit', 'node', ['scripts/run-api-tests.mjs', 'tests/unit_tests', '-q']);

  if (!skipFunctional && token) {
    const apiUp = await probe(`${baseApi}/api/v1/health`);
    if (!apiUp) {
      console.warn(`[gate] skip functional:api — API not up at ${baseApi}`);
    } else {
      await run('Gate A · functional API (all surfaces)', 'node', ['scripts/functional-api-suite.mjs'], {
        env: { FUNC_API: baseApi, FUNC_TOKEN: token },
      });
    }
  } else if (!skipFunctional && !token) {
    console.warn('[gate] skip functional:api — no token');
  }

  if (!skipE2e) {
    const webUp = await probe(`${baseWeb}/`);
    if (!webUp) {
      console.warn(`[gate] web not reachable at ${baseWeb} — starting Playwright webServer`);
    }
    const e2eEnv = {
      E2E_BASE_URL: baseWeb,
      E2E_API: baseApi,
      ...(token ? { E2E_TOKEN: token } : {}),
      E2E_WORKERS: process.env.E2E_WORKERS || '2',
    };
    await run('Gate A · e2e', 'npm', ['run', 'test:e2e'], { env: e2eEnv });
  }

  if (!skipAgent && token) {
    const apiUp = await probe(`${baseApi}/api/v1/health`);
    if (!apiUp) {
      console.warn(`[gate] skip agent stress — API not up at ${baseApi}`);
    } else {
      await run(
        'Gate A · agent stress (design cases)',
        'node',
        ['scripts/design-agent-stress.mjs'],
        {
          env: {
            STRESS_API: baseApi,
            STRESS_TOKEN: token,
            STRESS_CONCURRENCY: process.env.STRESS_CONCURRENCY || '2',
          },
        }
      );
      await run(
        'Gate A · agent stress (system cases)',
        'node',
        ['scripts/design-agent-stress.mjs', '--system'],
        {
          env: {
            STRESS_API: baseApi,
            STRESS_TOKEN: token,
            STRESS_CONCURRENCY: process.env.STRESS_CONCURRENCY || '2',
            STRESS_OUT: path.join(root, '.tmp-design-agent-stress-system.json'),
          },
        }
      );
    }
  } else if (!skipAgent && !token) {
    console.warn('[gate] skip agent stress — no E2E_TOKEN / .tmp-token.txt');
  }
}

if (wantB && !skipK6) {
  const apiUp = await probe(`${baseApi}/`);
  if (!apiUp) {
    console.error(`[gate] Gate B needs API at ${baseApi}`);
    process.exit(1);
  }
  await run('Gate B · k6 smoke', 'k6', ['run', 'perf/k6/smoke.js'], {
    env: { BASE_URL: baseApi },
  });
  if (token) {
    await run('Gate B · k6 api_crud', 'k6', ['run', 'perf/k6/api_crud.js'], {
      env: { BASE_URL: baseApi, PERF_TOKEN: token },
    });
  } else {
    console.warn('[gate] skip k6 api_crud — no token');
  }
  const collabUrl = process.env.COLLAB_WS_URL || 'ws://127.0.0.1:1234';
  await run('Gate B · k6 collab', 'k6', ['run', 'perf/k6/collab_ws.js'], {
    env: { COLLAB_WS_URL: collabUrl },
  });
}

console.log('\n══ Quality gate complete ══\n');
