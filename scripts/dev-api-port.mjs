/** Shared local API port for Vite proxy and `npm run dev:api`. */
export const DEFAULT_DEV_API_PORT = 8000;

/** Read `VITE_DEV_API_PORT` from process env (supports merged Vite loadEnv objects). */
export function resolveDevApiPort(env = process.env) {
  const raw = String(env.VITE_DEV_API_PORT || '').trim();
  if (!raw) return DEFAULT_DEV_API_PORT;
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_DEV_API_PORT;
}
