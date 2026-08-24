import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';

const isTauri = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig(({ mode }) => {
  // Prefer repo-root / apps/web env; support both GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID
  const envWeb = loadEnv(mode, path.resolve(__dirname), '');
  const envRoot = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const googleClientId =
    envWeb.GOOGLE_CLIENT_ID ||
    envWeb.VITE_GOOGLE_CLIENT_ID ||
    envRoot.GOOGLE_CLIENT_ID ||
    envRoot.VITE_GOOGLE_CLIENT_ID ||
    '';
  const docsUrl = (
    envWeb.VITE_DOCS_URL ||
    envRoot.VITE_DOCS_URL ||
    (mode === 'development' ? 'http://localhost:5175' : 'https://recombyn.github.io/recombyn')
  ).replace(/\/$/, '');
  // Desktop flavors: local (auto-login BYOK) | cloud (local or hosted API, platform catalog).
  const desktopMode = (
    process.env.VITE_DESKTOP_MODE ||
    process.env.RECOMBYN_DESKTOP_MODE ||
    envWeb.VITE_DESKTOP_MODE ||
    envRoot.VITE_DESKTOP_MODE ||
    ''
  )
    .trim()
    .toLowerCase();
  const apiBaseUrl = (
    process.env.VITE_API_BASE_URL ||
    envWeb.VITE_API_BASE_URL ||
    envRoot.VITE_API_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');

  // Default proxy → local uvicorn. Only remote http(s) hosts override the target.
  const apiProxyTarget =
    apiBaseUrl && /^https?:\/\//i.test(apiBaseUrl) && !/127\.0\.0\.1|localhost/i.test(apiBaseUrl)
      ? apiBaseUrl
      : 'http://127.0.0.1:8000';
  const apiProxySecure = /^https:\/\//i.test(apiProxyTarget);

  const commercialDevRoot = path.resolve(__dirname, '../../src/commercial/web');
  const commercialOssRoot = path.resolve(__dirname, 'src/commercial-oss');
  const commercialRoot = fs.existsSync(commercialDevRoot) ? commercialDevRoot : commercialOssRoot;

  return {
    // Keep Rust compiler output visible when `tauri dev` runs Vite.
    clearScreen: false,
    plugins: [
      react(),
      createSvgIconsPlugin({
        iconDirs: [path.resolve(__dirname, 'src/assets/svg')],
        symbolId: 'icon-[dir]-[name]',
        inject: 'body-last',
        customDomId: '__svg__icons__dom__',
        svgoOptions: {
          plugins: [
            {
              name: 'preset-default',
              params: {
                overrides: {
                  removeViewBox: false,
                  // Keep multi-color brand marks (logo_mark) intact.
                  convertColors: false,
                },
              },
            },
            // Monochrome UI icons already use currentColor in source.
          ],
        },
      }),
    ],
    define: {
      __GOOGLE_CLIENT_ID__: JSON.stringify(googleClientId),
      __DOCS_URL__: JSON.stringify(docsUrl),
      __DESKTOP_MODE__: JSON.stringify(desktopMode),
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@commercial': commercialRoot,
        '@canvas-plugins': path.resolve(__dirname, '../../plugins/canvas'),
      },
      // Prefer TS sources — leftover/cached `.js` URLs must not 404 after sibling emits were removed.
      extensions: ['.mjs', '.mts', '.ts', '.tsx', '.jsx', '.js', '.json'],
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.jsx': ['.tsx', '.jsx'],
      },
    },
    optimizeDeps: {
      // Prebundle oRPC client stack; never pull `@orpc/server` (backend-only, not installed).
      include: [
        'fontkit',
        '@orpc/client',
        '@orpc/contract',
        '@orpc/openapi-client',
        '@orpc/openapi-client/fetch',
        '@orpc/tanstack-query',
        '@tanstack/react-query',
        // nuqs RR adapter is a subpath export — without include Vite can 504 and blank the app.
        'nuqs',
        'nuqs/adapters/react-router/v6',
      ],
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core', '@orpc/server', '@recombyn/contracts'],
    },
    assetsInclude: ['**/*.wasm'],
    server: {
      // Listen on all local interfaces so both localhost and 127.0.0.1 work on Windows.
      host: true,
      port: 3000,
      strictPort: true,
      // Browser auto-open only for plain `npm run dev`, not under Tauri.
      open: !isTauri,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self' https://accounts.google.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https: wss: ws: blob: http://127.0.0.1:8000 http://localhost:8000 http://127.0.0.1:3000 http://localhost:3000; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'self'",
      },
      fs: {
        allow: [path.resolve(__dirname), path.resolve(__dirname, '../..')],
      },
      watch: {
        ignored: ['**/src-tauri/**'],
      },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: apiProxySecure,
          // 0 = no limit (http-proxy skips setTimeout when falsy). Design SSE can run many minutes.
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: isTauri ? Boolean(process.env.TAURI_ENV_DEBUG) : true,
      // Windows WebView2 ≈ Chromium; macOS/Linux use WebKit.
      ...(isTauri
        ? {
            target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
            minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
          }
        : {}),
    },
  };
});
