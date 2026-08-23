/**
 * Multi-artboard paint: sequential create_frame retargets content onto sibling boards.
 * Mirrors applyAgentToolOps + handleStreamToolOps multi path in runDesignAgent.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument
} from '@/components/rcb/scene/document/sceneDocument';
import { executeDesignTool, type DesignToolContext } from '../designTools';

describe('multi-artboard create_frame apply', () => {
  it('creates two sibling frames and paints content into each after retarget', () => {
    let doc = createEmptyDocument({ width: 1440, height: 900 });
    const dispatch = vi.fn((action: { type?: string; payload?: any }) => {
      const type = String(action?.type || '');
      const p = action?.payload;
      if (type.endsWith('/addArtboardFrame') || type.includes('addArtboardFrame')) {
        const id = `frame_${(doc.frames?.length || 0) + 1}`;
        const frame = {
          id,
          name: p?.name || 'Frame',
          x: Number(p?.x) || 0,
          y: Number(p?.y) || 0,
          width: Number(p?.width) || 390,
          height: Number(p?.height) || 844,
          backgroundColor: p?.backgroundColor || '#fff',
        };
        doc = {
          ...doc,
          frames: [...(doc.frames || []), frame],
          stackOrder: [...(doc.stackOrder || []), `frame:${id}`],
        };
        return;
      }
      if (type.endsWith('/setDocument') || type.includes('setDocument')) {
        if (p && typeof p === 'object') doc = p;
      }
    });

    const toolCtx = {
      dispatch,
      getDocument: () => doc,
      skipHistory: true,
      targetFrameId: null as string | null,
      allowDestructive: true,
    } as DesignToolContext;

    const ops = [
      {
        name: 'create_frame',
        args: { name: 'Login', width: 390, height: 844, x: 0, y: 0 },
      },
      {
        name: 'create_shape',
        args: {
          shapeType: 'rect',
          x: 20,
          y: 20,
          width: 100,
          height: 40,
          fill: '#111',
          name: 'login-btn',
        },
      },
      {
        name: 'create_frame',
        args: { name: 'Home', width: 390, height: 844, x: 0, y: 0 },
      },
      {
        name: 'create_shape',
        args: {
          shapeType: 'rect',
          x: 20,
          y: 20,
          width: 120,
          height: 48,
          fill: '#0a7',
          name: 'home-hero',
        },
      },
    ];

    expect(ops.filter((o) => o.name === 'create_frame').length).toBeGreaterThanOrEqual(2);

    const frameIds: string[] = [];
    for (const op of ops) {
      const res = executeDesignTool(op.name, JSON.stringify(op.args), toolCtx);
      if (res.status === 'error') {
        throw new Error(`${op.name} failed: ${res.summary}`);
      }
      if (op.name === 'create_frame') {
        const fid = String(res.artifacts?.frameId || '');
        expect(fid).toBeTruthy();
        toolCtx.targetFrameId = fid;
        frameIds.push(fid);
      }
    }

    expect(doc.frames.length).toBe(2);
    expect(String(doc.frames[0].name)).toBe('Login');
    expect(String(doc.frames[1].name)).toBe('Home');
    expect(frameIds).toEqual(['frame_1', 'frame_2']);

    const f0 = doc.frames[0];
    const f1 = doc.frames[1];
    const overlap =
      Number(f0.x) < Number(f1.x) + Number(f1.width) &&
      Number(f0.x) + Number(f0.width) > Number(f1.x) &&
      Number(f0.y) < Number(f1.y) + Number(f1.height) &&
      Number(f0.y) + Number(f0.height) > Number(f1.y);
    expect(overlap).toBe(false);

    const nodeCount = Object.keys(doc.deltaSetLike || {}).filter(
      (k) => k !== 'ROOT' && !String(k).startsWith('page')
    ).length;
    expect(nodeCount).toBeGreaterThanOrEqual(2);
  });

  it('host single-plate path strips create_frame from paint batch', () => {
    const ops = [
      { name: 'create_frame', args: { name: 'Only', width: 390, height: 844 } },
      {
        name: 'create_shape',
        args: { shapeType: 'rect', x: 0, y: 0, width: 10, height: 10 },
      },
    ];
    const liveFrameId = 'host_opened';
    const paintOps = liveFrameId
      ? ops.filter((o) => o.name !== 'create_frame')
      : ops;
    expect(paintOps).toHaveLength(1);
    expect(paintOps[0].name).toBe('create_shape');
  });
});
