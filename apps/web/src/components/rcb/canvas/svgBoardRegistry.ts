/**
 * Live editor paint board handle (runtime only — not Redux / document state).
 */
export type SvgBoardHandle = {
  root: SVGSVGElement;
  /** Layer that holds scene nodes (excludes chrome). */
  layer: SVGGElement;
  /** nodeId → SVG paint element */
  nodeEls: Map<string, SVGElement>;
  loadSeq?: number;
  getSvgElement: () => SVGSVGElement | null;
  /** Serialize scene layer for export (no UI chrome). */
  toSvgString: () => string;
};

let board: SvgBoardHandle | null = null;

export function setSvgBoard(next: SvgBoardHandle | null) {
  board = next;
}

export function getSvgBoard() {
  return board;
}
