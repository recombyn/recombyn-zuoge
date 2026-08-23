import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve auth for browser journeys that need a logged-in session.
 * Prefer `E2E_TOKEN`; fall back to repo-root `.tmp-token.txt` for local runs.
 * Never throw at import time — missing token should `test.skip`, not crash CI.
 */
export function resolveE2EToken(repoRoot: string): string {
  const fromEnv = (process.env.E2E_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return fs.readFileSync(path.join(repoRoot, '.tmp-token.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

export const E2E_TOKEN_SKIP_REASON =
  'Set E2E_TOKEN or create .tmp-token.txt (authenticated browser journeys)';
