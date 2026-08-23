/**
 * Mockup capability helpers (OSS-safe).
 * Render implementation lives in src/commercial/web (private repo only).
 */

import { getHttpErrorMessage } from '@/service/client';
import type { ImageToolCapabilities } from '@/service/imageTools';

export type MockupRenderResult = {
  image: string;
  kind: string;
  template_id?: string;
  width?: number;
  height?: number;
  engines?: string[];
  warnings?: string[];
};

export function isMockupEnabled(caps?: ImageToolCapabilities | null): boolean {
  return caps?.mockup?.enabled === true;
}

export async function renderMockup(
  image: string,
  templateId = 'demo-cylinder'
): Promise<MockupRenderResult> {
  const mod = await import(/* @vite-ignore */ '@commercial/mockup/mockupTools').catch(() => null);
  if (!mod?.renderMockup) {
    throw new Error('Mockup package not available (recombyn-dev includes src/commercial/web/mockup)');
  }
  return mod.renderMockup(image, templateId);
}

export function mockupErrorMessage(err: unknown, fallback: string): string {
  return getHttpErrorMessage(err, fallback);
}
