import { memo } from 'react';

/** Artboard movement and selection are owned exclusively by its title label. */
function FrameMoveFeature(_props: { [key: string]: unknown }) {
  // Artboard movement is owned by the title label. The body must stay a normal
  // canvas surface so clicks select nodes and drags can marquee or draw.
  return null;
}

export default memo(FrameMoveFeature);
