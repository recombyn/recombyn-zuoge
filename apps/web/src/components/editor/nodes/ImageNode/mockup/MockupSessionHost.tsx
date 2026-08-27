import { lazy, Suspense, memo, type ReactNode } from 'react';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const EmptyMockupHost = memo(function EmptyMockupHost(_props: {
  document: SceneDocument;
  hidden?: boolean;
}) {
  return null;
});

const PrivateMockupSessionHost = lazy(() =>
  import(/* @vite-ignore */ '@commercial/mockup/MockupSessionHost')
    .then((m) => ({ default: m.default as typeof EmptyMockupHost }))
    .catch(() => ({ default: EmptyMockupHost }))
);

/**
 * Lazy-loads mockup session UI from @commercial when available.
 */
function MockupSessionHost({
  document,
  hidden = false,
}: {
  document: SceneDocument;
  hidden?: boolean;
}): ReactNode {
  return (
    <Suspense fallback={null}>
      <PrivateMockupSessionHost document={document} hidden={hidden} />
    </Suspense>
  );
}

export default MockupSessionHost;
