import { memo, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import PathEditToolbar, {
  type PathEditSubtool,
} from '@/components/editor/chrome/PathEditToolbar';
import PenStrokeToolbar from '@/components/editor/chrome/PenStrokeToolbar';
import BucketFillToolbar from '@/components/editor/chrome/BucketFillToolbar';
import { setActiveTool } from '@/store/modules/editor';

const DOCK_CLASS =
  'pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2 hidden md:block';

type Props = {
  isDevMode: boolean;
  pathEditOpen: boolean;
  pathEditSubtool: PathEditSubtool;
  onPathEditSubtool: (s: PathEditSubtool) => void;
  onPathEditExit: () => void;
  activeTool: string;
  zoom?: number;
  viewportWidth?: number;
  docWidth?: number;
};

/** Top-center floating tool docks (path edit / pen / bucket). */
function EditorToolDocks({
  isDevMode,
  pathEditOpen,
  pathEditSubtool,
  onPathEditSubtool,
  onPathEditExit,
  activeTool,
  zoom = 1,
  viewportWidth,
  docWidth,
}: Props) {
  const dispatch = useDispatch();
  if (isDevMode) return null;

  let body: ReactNode = null;
  if (pathEditOpen) {
    body = (
      <PathEditToolbar
        subtool={pathEditSubtool}
        onSubtoolChange={(s) => {
          onPathEditSubtool(s);
          window.dispatchEvent(
            new CustomEvent('resume:path-edit-subtool', { detail: { subtool: s } })
          );
          // Path-edit Pen is local — do not activate the bottom toolstrip Pen.
          dispatch(setActiveTool('select'));
        }}
        onExit={() => {
          window.dispatchEvent(new Event('resume:exit-path-edit'));
          onPathEditExit();
        }}
      />
    );
  } else if (activeTool === 'pen' || activeTool === 'pencil') {
    body = (
      <PenStrokeToolbar
        mode={activeTool === 'pencil' ? 'pencil' : 'pen'}
        placement="dock"
        zoom={zoom}
        viewportWidth={viewportWidth}
        docWidth={docWidth}
      />
    );
  } else if (activeTool === 'bucket') {
    body = <BucketFillToolbar />;
  }

  if (!body) return null;
  return <div className={DOCK_CLASS}>{body}</div>;
}

export default memo(EditorToolDocks);
