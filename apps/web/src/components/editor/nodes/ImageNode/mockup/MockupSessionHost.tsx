import { lazy, Suspense, memo, type ReactNode } from 'react';
import type { SceneDocument } from '@/components/rcb/sceneNode';

const EmptyMockupHost = memo(function EmptyMockupHost(_props: { document: SceneDocument }) {
  return null;
});

const PrivateMockupSessionHost = lazy(() =>
  import(/* @vite-ignore */ '@commercial/mockup/MockupSessionHost')
    .then((m) => ({ default: m.default }))
    .catch(() => ({ default: EmptyMockupHost }))
);

/**
 * OSS entry: lazy-loads closed-source UI from src/commercial/web (stripped on public sync).
 */
function MockupSessionHost({ document }: { document: SceneDocument }): ReactNode {
  return (
    <Suspense fallback={null}>
      <PrivateMockupSessionHost document={document} />
    </Suspense>
  );
}

export default MockupSessionHost;
