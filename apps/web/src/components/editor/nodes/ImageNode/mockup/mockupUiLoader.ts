/**
 * Mockup UI is always shipped in this open-source tree.
 */

export function getMockupUiInstalled(): boolean {
  return true;
}

export function probeMockupUiInstalled(): Promise<boolean> {
  return Promise.resolve(true);
}
