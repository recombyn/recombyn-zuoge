/**
 * Detect closed-source mockup UI under src/commercial/web (stripped on OSS sync).
 * OSS clones without that folder keep the toolbar hidden.
 */

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

export function getMockupUiInstalled(): boolean | null {
  return cached;
}

export function probeMockupUiInstalled(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!pending) {
    pending = import(/* @vite-ignore */ '@commercial/mockup')
      .then(() => {
        cached = true;
        return true;
      })
      .catch(() => {
        cached = false;
        return false;
      });
  }
  return pending;
}
