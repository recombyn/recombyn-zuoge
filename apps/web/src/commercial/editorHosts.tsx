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
      <MarkSessionHost document={document} hidden={selectionTransforming} />
      <MockupSessionHost document={document} hidden={selectionTransforming} />
    </>
  );
}
