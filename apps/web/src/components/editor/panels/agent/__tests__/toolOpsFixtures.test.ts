import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizeDocument } from '@/components/rcb/scene/document/sceneDocument';
import { executeDesignTool } from '../designTools';
import { createDesignToolHarness } from './designToolHarness';

type FixtureCase = {
  id: string;
  doc?: Record<string, unknown>;
  ops: Array<{ name?: string; args?: Record<string, unknown> }>;
  expect: Record<string, unknown>;
};

const FIXTURE_DIR = resolve(
  __dirname,
  '../../../../../../../../tests/fixtures/tool_ops'
);

function loadFixtures(): FixtureCase[] {
  try {
    return readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8')) as FixtureCase)
      .filter((item) => item?.id && Array.isArray(item.ops));
  } catch {
    return [];
  }
}

function sceneNodes(doc: ReturnType<typeof createDesignToolHarness>['getDoc'] extends () => infer D ? D : never) {
  const delta = doc.deltaSetLike || {};
  return Object.entries(delta)
    .filter(([nid, node]) => nid !== 'ROOT' && node && typeof node === 'object')
    .map(([nid, node]) => ({
      id: nid,
      ...(node as { key?: string; x?: number; y?: number; attrs?: Record<string, unknown> }),
    }));
}

describe('shared tool_ops fixtures (live designTools)', () => {
  for (const fixture of loadFixtures()) {
    it(fixture.id, () => {
      const expectSpec = fixture.expect || {};
      const frameId = String(expectSpec.frameId || '');
      const initial = fixture.doc
        ? normalizeDocument(fixture.doc as Parameters<typeof normalizeDocument>[0])
        : undefined;
      const harness = createDesignToolHarness({
        doc: initial,
        targetFrameId: frameId || null,
      });
      for (const op of fixture.ops) {
        const name = String(op.name || '').trim();
        if (!name) continue;
        executeDesignTool(name, JSON.stringify(op.args || {}), harness.ctx);
      }
      const doc = harness.getDoc();

      if (expectSpec.shapeCount != null) {
        const shapes = sceneNodes(doc).filter((n) => n.key === 'shape');
        expect(shapes).toHaveLength(Number(expectSpec.shapeCount));
        expect(Number(shapes[0]?.x)).toBe(Number(expectSpec.worldX));
        expect(Number(shapes[0]?.y)).toBe(Number(expectSpec.worldY));
      }

      if (expectSpec.createdCount != null) {
        const created = sceneNodes(doc).filter((n) => n.key !== 'frame');
        expect(created).toHaveLength(Number(expectSpec.createdCount));
      }
    });
  }
});
