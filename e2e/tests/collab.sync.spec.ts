/**
 * Gate A — collab room identity, dual-client WS presence, project revision conflict.
 *
 * Requires E2E_TOKEN. Optional live WS: set E2E_COLLAB_WS=ws://127.0.0.1:1234
 * and run apps/collab with the same COLLAB_TOKEN_SECRET as the API.
 */
import { test, expect } from '@playwright/test';
import { E2E_TOKEN_SKIP_REASON, resolveE2EToken } from './e2eAuth';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(__dirname, '../..');
const TOKEN = resolveE2EToken(ROOT);
const API = (process.env.E2E_API || 'http://127.0.0.1:8000').replace(/\/$/, '');
const COLLAB_WS = (process.env.E2E_COLLAB_WS || '').replace(/\/$/, '');
const SECRET =
  process.env.COLLAB_TOKEN_SECRET || 'dev-collab-token-secret-change-me';

function mintRoomToken(roomId: string, userId: string) {
  const payload = {
    roomId,
    userId,
    role: 'edit',
    name: 'e2e',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const body = Buffer.from(JSON.stringify(payload))
    .toString('base64url')
    .replace(/=+$/, '');
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(body)
    .digest('base64url')
    .replace(/=+$/, '');
  return `${body}.${sig}`;
}

test.describe('collab sync', () => {
  test.skip(!TOKEN, E2E_TOKEN_SKIP_REASON);

  test('room-token endpoint returns stable roomId for a project', async ({
    request,
  }) => {
    const projectId = `e2e-collab-${Date.now()}`;
    const created = await request.put(`${API}/api/v1/projects`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: { id: projectId, name: 'E2E Collab' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    const a = await request.post(`${API}/api/v1/collab/room-token`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: { projectId },
    });
    expect(a.ok(), await a.text()).toBeTruthy();
    const ta = await a.json();

    const b = await request.post(`${API}/api/v1/collab/room-token`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: { projectId },
    });
    expect(b.ok(), await b.text()).toBeTruthy();
    const tb = await b.json();

    expect(ta.roomId).toBe(projectId);
    expect(tb.roomId).toBe(ta.roomId);
    expect(String(ta.token || '').length).toBeGreaterThan(10);
    expect(String(tb.token || '').length).toBeGreaterThan(10);
  });

  test('dual WebSocket clients both authenticate to the same room', async () => {
    test.skip(!COLLAB_WS, 'Set E2E_COLLAB_WS to run dual WS check');

    const roomId = `e2e-dual-${Date.now()}`;
    const t1 = mintRoomToken(roomId, 'e2e-a');
    const t2 = mintRoomToken(roomId, 'e2e-b');

    async function openOnce(token: string) {
      return await new Promise<{ ok: boolean; code?: number }>((resolve) => {
        const url = `${COLLAB_WS}/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve({ ok: false, code: -1 });
        }, 8000);
        ws.addEventListener('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve({ ok: true });
        });
        ws.addEventListener('error', () => {
          clearTimeout(timer);
          resolve({ ok: false });
        });
        ws.addEventListener('close', (ev) => {
          clearTimeout(timer);
          if (ev.code === 1000) resolve({ ok: true });
        });
      });
    }

    const [r1, r2] = await Promise.all([openOnce(t1), openOnce(t2)]);
    expect(r1.ok, JSON.stringify(r1)).toBe(true);
    expect(r2.ok, JSON.stringify(r2)).toBe(true);
  });

  test('stale baseRevision PATCH returns project_revision_conflict', async ({
    request,
  }) => {
    const projectId = `e2e-rev-${Date.now()}`;
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    };
    const created = await request.put(`${API}/api/v1/projects`, {
      headers,
      data: { id: projectId, name: 'E2E Rev Conflict' },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const createdBody = await created.json();
    let rev = createdBody?.project?.revision ?? createdBody?.revision;
    if (rev == null) {
      const got = await request.get(`${API}/api/v1/projects/${projectId}`, { headers });
      expect(got.ok(), await got.text()).toBeTruthy();
      const body = await got.json();
      rev = body?.project?.revision ?? body?.revision;
    }
    expect(rev).not.toBeNull();
    expect(rev).not.toBeUndefined();

    const ok = await request.patch(`${API}/api/v1/projects/${projectId}`, {
      headers,
      data: { name: `ok-${Date.now()}`, baseRevision: rev },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();

    const stale = await request.patch(`${API}/api/v1/projects/${projectId}`, {
      headers,
      data: { name: `stale-${Date.now()}`, baseRevision: rev },
    });
    expect(stale.status()).toBe(412);
    const body = await stale.json();
    const code = body?.detail?.code || body?.code;
    expect(code).toBe('project_revision_conflict');
  });

  test('dual Yjs clients converge concurrent map writes', async () => {
    test.skip(!COLLAB_WS, 'Set E2E_COLLAB_WS to run dual Yjs merge');
    const { spawnSync } = await import('node:child_process');
    const script = path.resolve(ROOT, 'apps/collab/dual_client_merge.test.mjs');
    const r = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        COLLAB_WS_URL: COLLAB_WS,
        COLLAB_TOKEN_SECRET: SECRET,
      },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  });
});
