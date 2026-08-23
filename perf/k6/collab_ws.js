/**
 * Gate B — collab WebSocket open/auth under load.
 * Mints HMAC room tokens locally (same scheme as apps/api collab_tokens).
 *
 *   COLLAB_WS_URL=ws://127.0.0.1:1234 k6 run perf/k6/collab_ws.js
 *   COLLAB_TOKEN_SECRET=... (must match collab server)
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';

const WS_BASE = (__ENV.COLLAB_WS_URL || 'ws://127.0.0.1:1234').replace(/\/$/, '');
const SECRET = __ENV.COLLAB_TOKEN_SECRET || 'dev-collab-token-secret-change-me';

export const options = {
  vus: 5,
  duration: '45s',
  thresholds: {
    checks: ['rate>0.95'],
    ws_connecting: ['p(95)<2000'],
    ws_session_duration: ['p(95)>500'],
  },
};

function b64urlJson(obj) {
  const raw = JSON.stringify(obj);
  return encoding.b64encode(raw, 'rawurl').replace(/=+$/, '');
}

function mintToken(roomId, userId) {
  const payload = {
    roomId: String(roomId),
    userId: String(userId),
    role: 'edit',
    name: 'k6',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const body = b64urlJson(payload);
  const sig = crypto.hmac('sha256', SECRET, body, 'base64rawurl').replace(/=+$/, '');
  return `${body}.${sig}`;
}

export default function () {
  const roomId = `k6-room-${__VU}`;
  const token = mintToken(roomId, `k6-user-${__VU}-${__ITER}`);
  const url = `${WS_BASE}/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      sleep(0.8);
      socket.close();
    });
    socket.on('error', () => {
      socket.close();
    });
    socket.setTimeout(() => {
      socket.close();
    }, 5000);
  });

  check(res, { 'ws status 101': (r) => r && r.status === 101 });
  sleep(0.2);
}
