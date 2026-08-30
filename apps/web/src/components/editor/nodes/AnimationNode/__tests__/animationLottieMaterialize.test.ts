import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyDocument } from '@/components/rcb/scene/document/sceneDocument';
import { parseLottieAnimationData } from '@/components/rcb/scene/document/nodeFactories';
import { materializeRootShapeLayers, explodeLinkedLottiePlate } from '../animationLottieMaterialize';
import { animationHostHasUnlinkedInk } from '../animationFrameSync';
import { createLottieNode } from '@/components/rcb/scene/document/nodeFactories';
import { addNodeToDocument } from '@/components/rcb/scene/document/sceneDocument';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('materializeRootShapeLayers', () => {
  it('explodes Blue Square into a linked shape node', () => {
    const raw = readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8');
    const anim = parseLottieAnimationData(raw);
    expect(anim).toBeTruthy();
    const doc = createEmptyDocument({ emptyWorld: true });
    (doc as any).frames = [
      {
        id: 'af1',
        kind: 'animation',
        x: 0,
        y: 0,
        width: 240,
        height: 240,
        backgroundColor: '#fff',
        clipContent: true,
      },
    ];
    const result = materializeRootShapeLayers({
      document: doc,
      frameId: 'af1',
      animationData: anim,
      plate: { x: 0, y: 0, width: 240, height: 240 },
    });
    expect(result).toBeTruthy();
    expect(result!.nodeIds).toHaveLength(1);
    const shape = result!.document.deltaSetLike![result!.nodeIds[0]];
    expect(shape.key).toBe('shape');
    expect(shape.attrs?.name).toBe('Blue Square');
    expect(String(shape.attrs?.frameId)).toBe('af1');
    expect(animationHostHasUnlinkedInk(result!.animationJson)).toBe(false);
  });

  it('explodeLinkedLottiePlate turns nested lot into shapes and drops the plate', () => {
    const raw = readFileSync(join(FIXTURES, 'retake-lot-edited.json'), 'utf8');
    const anim = parseLottieAnimationData(raw);
    expect(anim).toBeTruthy();
    let doc = createEmptyDocument({ emptyWorld: true });
    (doc as any).frames = [
      {
        id: 'af1',
        kind: 'animation',
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        backgroundColor: '#fff',
        clipContent: true,
      },
    ];
    const { id: hostId, node: hostNode } = createLottieNode({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      name: 'host',
      animationData: {
        v: '5.7.4',
        fr: 30,
        ip: 0,
        op: 60,
        w: 400,
        h: 400,
        layers: [
          {
            ind: 1,
            ty: 0,
            nm: 'nested',
            refId: 'lot_plate1',
            ln: 'plate1',
            ip: 0,
            op: 60,
            ks: {},
          },
        ],
        assets: [
          {
            id: 'lot_plate1',
            nm: 'nested',
            w: 240,
            h: 240,
            layers: (anim as any).layers,
          },
        ],
      },
    });
    hostNode.attrs = {
      ...(hostNode.attrs || {}),
      frameId: 'af1',
      animationFrameHost: true,
    };
    doc = addNodeToDocument(doc, hostId, hostNode);
    const { node: lotNode } = createLottieNode({
      x: 80,
      y: 80,
      width: 240,
      height: 240,
      name: 'nested',
      animationData: anim,
    });
    lotNode.attrs = {
      ...(lotNode.attrs || {}),
      frameId: 'af1',
      frameOrder: 1,
    };
    const plateId = 'plate1';
    doc = addNodeToDocument(doc, plateId, { ...lotNode, id: plateId });

    const exploded = explodeLinkedLottiePlate({
      document: doc,
      lotNodeId: plateId,
      hostNodeId: hostId,
      frameId: 'af1',
    });
    expect(exploded).toBeTruthy();
    expect(exploded!.document.deltaSetLike?.[plateId]).toBeUndefined();
    expect(exploded!.nodeIds.length).toBe(1);
    const shape = exploded!.document.deltaSetLike![exploded!.nodeIds[0]];
    expect(shape.key).toBe('shape');
    expect(shape.attrs?.name).toBe('Blue Square');
    const hostAnim = parseLottieAnimationData(
      exploded!.document.deltaSetLike![hostId].attrs?.animationData
    );
    expect(
      ((hostAnim!.layers as any[]) || []).some((l) => String(l.ln) === exploded!.nodeIds[0])
    ).toBe(true);
    expect(
      ((hostAnim!.layers as any[]) || []).some((l) => l.refId === 'lot_plate1')
    ).toBe(false);
  });
});
