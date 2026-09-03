/** FE mockup helpers — no server render API. */

import type { MockupRenderResult } from '@/service/mockupTools';

/**
 * Server bake was removed. Callers should use Canvas UV preview
 * (`createMockupUvPreview`) instead.
 */
export async function renderMockup(
  _image: string,
  _templateId = 'demo-cylinder'
): Promise<MockupRenderResult> {
  throw new Error('Mockup server render is not available; use on-canvas UV preview');
}
