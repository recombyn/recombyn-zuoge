import type { SceneDocument } from '@/components/rcb/sceneNode';
import type { ReactNode } from 'react';
import MarkSessionHost from '@/components/editor/nodes/ImageNode/mark/MarkSessionHost';
import MockupSessionHost from '@/components/editor/nodes/ImageNode/mockup/MockupSessionHost';

/** Commercial canvas session hosts. */
export function CommercialEditorHosts({
  document,
  selectionTransforming,
}: {
  document: SceneDocument;
  selectionTransforming?: boolean;
}): ReactNode {
  return (
    <>
      {/* Mark must stay mounted while selectionTransforming flickers / sticks —
          unmounting drops [data-mark-overlay] so SelectionFeature capture steals
          the gesture and chips never commit. Mockup can still hide mid-drag. */}
      <MarkSessionHost document={document} />
      <MockupSessionHost document={document} hidden={selectionTransforming} />
    </>
  );
}
