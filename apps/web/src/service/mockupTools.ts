/**
 * Mockup capability helpers — FE-only UV preview (no server bake API).
 */

import { getHttpErrorMessage } from '@/service/client';
import type { ImageToolCapabilities } from '@/service/imageTools';
import { renderMockup as renderMockupImpl } from '@/components/editor/nodes/ImageNode/mockup/mockupTools';

export type MockupRenderResult = {
  image: string;
  kind: string;
  template_id?: string;
  width?: number;
  height?: number;
  engines?: string[];
  warnings?: string[];
};

export function isMockupEnabled(_caps?: ImageToolCapabilities | null): boolean {
  return true;
}

export async function renderMockup(
  image: string,
  templateId = 'demo-cylinder'
): Promise<MockupRenderResult> {
  return renderMockupImpl(image, templateId);
}

export function mockupErrorMessage(err: unknown, fallback: string): string {
  const msg = getHttpErrorMessage(err, fallback);
  const trimmed = msg.trim();
  // FastAPI bare 404 / auth noise is useless for users (stale API / logged out).
  if (/^not found$/i.test(trimmed)) return fallback;
  if (/not authenticated/i.test(trimmed)) return fallback;
  return msg;
}
