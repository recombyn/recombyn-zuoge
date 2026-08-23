/**
 * Dual-client Yjs merge through the collab WS (CRDT conflict converge).
 *
 *   COLLAB_WS_URL=ws://127.0.0.1:1234 COLLAB_TOKEN_SECRET=… node dual_client_merge.test.mjs
 *
 * Exit 0 when both clients see each other's concurrent map writes.
 */
import crypto from 'node:crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const COLLAB_WS = (process.env.COLLAB_WS_URL || process.env.E2E_COLLAB_WS || 'ws://127.0.0.1:1234').replace(
  /\/$/,
  ''
);
const SECRET =
  process.env.COLLAB_TOKEN_SECRET || 'dev-collab-token-secret-change-me';
const messageSync = 0;
const ROOM = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function mintToken(roomId, userId) {
  const payload = {
    roomId,
    userId,
    role: 'edit',
    name: userId,
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

function connectYClient(userId) {
  const doc = new Y.Doc();
  const provider = { userId };
  const url = `${COLLAB_WS}/${encodeURIComponent(ROOM)}?token=${encodeURIComponent(mintToken(ROOM, userId))}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const sendSync = (writeFn) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    writeFn(encoder);
    ws.send(encoding.toUint8Array(encoder));
  };

  ws.on('message', (data) => {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const msgType = decoding.readVarUint(decoder);
    if (msgType !== messageSync) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    // origin=provider so local 'update' handler does not echo remote applies
    syncProtocol.readSyncMessage(decoder, encoder, doc, provider);
    if (encoding.length(encoder) > 1) {
      ws.send(encoding.toUint8Array(encoder));
    }
  });

  doc.on('update', (update, origin) => {
    if (origin === provider) return;
    sendSync((encoder) => {
      syncProtocol.writeUpdate(encoder, update);
    });
  });

  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ws timeout ${userId}`)), 10_000);
    ws.once('open', () => {
      sendSync((encoder) => {
        syncProtocol.writeSyncStep1(encoder, doc);
      });
      clearTimeout(t);
      resolve();
    });
    ws.once('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });

  return {
    doc,
    ws,
    ready,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      doc.destroy();
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const a = connectYClient('user-a');
  const b = connectYClient('user-b');
  await Promise.all([a.ready, b.ready]);
  await sleep(300);

  // Concurrent conflicting writes on the same Y.Map (CRDT keeps both keys).
  a.doc.getMap('scene').set('fromA', 'alpha');
  b.doc.getMap('scene').set('fromB', 'beta');

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const am = a.doc.getMap('scene');
    const bm = b.doc.getMap('scene');
    if (
      am.get('fromA') === 'alpha' &&
      am.get('fromB') === 'beta' &&
      bm.get('fromA') === 'alpha' &&
      bm.get('fromB') === 'beta'
    ) {
      console.log(`[collab:merge] ok room=${ROOM}`);
      a.close();
      b.close();
      process.exit(0);
    }
    await sleep(100);
  }

  console.error('[collab:merge] FAIL — docs did not converge', {
    a: Object.fromEntries(a.doc.getMap('scene').entries()),
    b: Object.fromEntries(b.doc.getMap('scene').entries()),
  });
  a.close();
  b.close();
  process.exit(1);
}

main().catch((err) => {
  console.error('[collab:merge]', err);
  process.exit(1);
});
