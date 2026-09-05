/**
 * Standard canvas API — prefer this entry over deep imports / fat `@/components/rcb` barrel.
 *
 * @see docs/CANVAS_GUIDE.md
 *
 * Import by facade to avoid duplicate symbol clashes:
 *   import { addNodeToDocument } from '@/components/rcb/api/Document'
 * Or from the barrel (facades re-exported once each):
 *   import { … } from '@/components/rcb/api'
 */
export * from './Document';
export * from './Camera';
export * from './Scene';
export * from './Renderer';
export * from './HitTest';
// Selection symbols that overlap Document are omitted from the barrel;
// import from `./Selection` for raise / stackPaint helpers.
export {
  stackPaintZ,
  stackPaintMaxZ,
  stackPaintNaturalZ,
  syncStackPaintOrder,
  setSelectionPaintRaiseIds,
  setSelectionPaintRaiseFrameIds,
  setFrameClipRevealOverflowIds,
  listSelectionRevealOverflowIds,
  selectionPaintRaises,
  selectionPaintRaisesFrame,
} from './Selection';
