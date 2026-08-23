/**
 * Mint a session token for CI / local Gate A+B (SUPER_ADMIN_TEST_CODE path).
 *
 *   SUPER_ADMIN_TEST_CODE=ci-test-otp node scripts/ci-mint-token.mjs
 *   # prints token to stdout; also writes .tmp-token.txt
 *
 * Env: EVAL_API / BASE_URL (default http://127.0.0.1:8000),
 *      SUPER_ADMIN_EMAIL (default admin@recombyn.com),
 *      SUPER_ADMIN_TEST_CODE (required)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = (process.env.EVAL_API || process.env.BASE_URL || 'http://127.0.0.1:8000').replace(
  /\/$/,
  ''
);
const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@recombyn.com').trim().toLowerCase();
const code = (process.env.SUPER_ADMIN_TEST_CODE || '').trim();

if (!code) {
  console.error('SUPER_ADMIN_TEST_CODE is required');
  process.exit(1);
}

const res = await fetch(`${API}/api/v1/auth/email/verify-code`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ email, code }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.token) {
  console.error(`mint failed ${res.status}: ${JSON.stringify(body)}`);
  process.exit(1);
}

const token = String(body.token).trim();
fs.writeFileSync(path.join(root, '.tmp-token.txt'), token, 'utf8');
process.stdout.write(token);
