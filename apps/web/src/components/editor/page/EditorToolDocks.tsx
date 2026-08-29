import { memo, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import PathEditToolbar, {
  type PathEditSubtool,
} from '@/components/editor/chrome/PathEditToolbar';
import PenStrokeToolbar from '@/components/editor/chrome/PenStrokeToolbar';
import BucketFillToolbar from '@/components/editor/chrome/BucketFillToolbar';
import { setActiveTool } from '@/store/modules/editor';

const FLOAT_CLASS =
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
  /**
   * `float` — top-center overlay (default).
   * `inline` — bare body for embedding in the timeline top rail (one div, centered by parent).
   */
  placement?: 'float' | 'inline';
};

/** Path edit / pen / bucket docks — float or inline in the timeline tool rail. */
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
  placement = 'float',
}: Props) {
  const dispatch = useDispatch();
  if (isDevMode) return null;

  const chrome = placement === 'inline' ? 'flat' : 'pill';

  let body: ReactNode = null;
  if (pathEditOpen) {
    body = (
      <PathEditToolbar
        chrome={chrome}
        subtool={pathEditSubtool}
        onSubtoolChange={(s) => {
          onPathEditSubtool(s);
          window.dispatchEvent(
            new CustomEvent('resume:path-edit-subtool', { detail: { subtool: s } })
          );
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
        chrome={chrome}
        zoom={zoom}
        viewportWidth={viewportWidth}
        docWidth={docWidth}
      />
    );
  } else if (activeTool === 'bucket') {
    body = <BucketFillToolbar chrome={chrome} />;
  }

  if (!body) return null;

  if (placement === 'inline') {
    return (
      <div className="pointer-events-auto flex items-center" data-editor-tool-dock-inline="">
        {body}
      </div>
    );
  }

  return <div className={FLOAT_CLASS}>{body}</div>;
}

export default memo(EditorToolDocks);
