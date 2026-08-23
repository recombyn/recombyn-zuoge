/**
 * Minimal Yjs WebSocket server with HMAC room-token auth.
 * Compatible with y-websocket client (yjs 13 + y-protocols).
 *
 * Env:
 *   HOST / PORT — bind (default 0.0.0.0:1234)
 *   COLLAB_TOKEN_SECRET — must match apps/api
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as map from 'lib0/map';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 1234);
const SECRET = Buffer.from(
  process.env.COLLAB_TOKEN_SECRET || 'dev-collab-token-secret-change-me',
  'utf8'
);

/** Optional OTel (ADR 0011) — same env contract as the API/worker. */
async function maybeStartOtel() {
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
  const enabledRaw = String(process.env.OTEL_ENABLED || '').trim().toLowerCase();
  const enabled =
    ['1', 'true', 'yes', 'on'].includes(enabledRaw) || Boolean(endpoint);
  if (!enabled) return null;
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import(
      '@opentelemetry/exporter-trace-otlp-http'
    );
    const { resourceFromAttributes } = await import('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = await import(
      '@opentelemetry/semantic-conventions'
    );
    const service =
      process.env.OTEL_SERVICE_NAME || 'recombyn-collab';
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: service }),
      traceExporter: endpoint
        ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })
        : undefined,
    });
    sdk.start();
    return sdk;
  } catch {
    return null;
  }
}

await maybeStartOtel();

const messageSync = 0;
const messageAwareness = 1;
const wsConnecting = 0;
const wsOpen = 1;
const pingTimeout = 30_000;

function b64urlDecode(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s + pad, 'base64url');
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sigB64] = token.split('.');
  if (!body || !sigB64) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest();
  let sig;
  try {
    sig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
  const roomId = String(payload.roomId || '').trim();
  const userId = String(payload.userId || '').trim();
  const role = String(payload.role || '').trim();
  if (!roomId || !userId || (role !== 'edit' && role !== 'view')) return null;
  return { roomId, userId, role, name: String(payload.name || '') };
}

const docs = new Map();

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const changed = added.concat(updated, removed);
      if (conn !== null) {
        const controlled = this.conns.get(conn);
        if (controlled) {
          added.forEach((id) => controlled.add(id));
          removed.forEach((id) => controlled.delete(id));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => send(this, c, buff));
    });
    this.on('update', (update) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => send(this, conn, message));
    });
  }
}

function getYDoc(docname) {
  return map.setIfUndefined(docs, docname, () => {
    const doc = new WSSharedDoc(docname);
    docs.set(docname, doc);
    return doc;
  });
}

function send(doc, conn, m) {
  if (conn.readyState !== wsConnecting && conn.readyState !== wsOpen) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err) => {
      if (err) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc, conn) {
  if (!doc.conns.has(conn)) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
    return;
  }
  const controlledIds = doc.conns.get(conn);
  doc.conns.delete(conn);
  awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
  if (doc.conns.size === 0) {
    docs.delete(doc.name);
    doc.destroy();
  }
  try {
    conn.close();
  } catch {
    /* ignore */
  }
}

function messageListener(conn, doc, message, readOnly) {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync: {
        if (readOnly) {
          // Viewers may sync / receive, but drop client→server updates.
          const peek = decoding.createDecoder(message);
          decoding.readVarUint(peek); // type
          const syncType = decoding.readVarUint(peek);
          if (syncType === syncProtocol.messageYjsUpdate) return;
        }
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
      default:
        break;
    }
  } catch (err) {
    closeConn(doc, conn);
  }
}

function setupWSConnection(conn, req, { docName, readOnly = false } = {}) {
  conn.binaryType = 'arraybuffer';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());
  conn.on('message', (message) => {
    messageListener(conn, doc, new Uint8Array(message), readOnly);
  });

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn);
      clearInterval(pingInterval);
      return;
    }
    if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);

  conn.on('close', () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on('pong', () => {
    pongReceived = true;
  });

  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const states = doc.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, messageAwareness);
      encoding.writeVarUint8Array(
        aw,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys()))
      );
      send(doc, conn, encoding.toUint8Array(aw));
    }
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('recombyn collab ok\n');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const docName = decodeURIComponent(url.pathname.replace(/^\//, '').split('/')[0] || '');
    const token = url.searchParams.get('token') || '';
    const claims = verifyToken(token);
    if (!claims || claims.roomId !== docName) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, claims);
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', (ws, req, claims) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const docName = decodeURIComponent(url.pathname.replace(/^\//, '').split('/')[0] || '');
  setupWSConnection(ws, req, {
    docName,
    readOnly: claims.role === 'view',
  });
});

server.listen(PORT, HOST);
