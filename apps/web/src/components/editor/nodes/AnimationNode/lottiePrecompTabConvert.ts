/**
 * Single conversion between 主场景 (locked preview) and LOT tab (editable).
 *
 * Same nested-lot JSON + same LottiePlate paint. Tab switch only flips edit lock
 * / timeline focus — never materialize, resize, or remount ink.
 */
import { linkedLotNodeIdFromAsset } from '@/components/editor/nodes/AnimationNode/animationPrecompEditModel';
import type { LottiePrecompEditState } from '@/components/editor/nodes/AnimationNode/animationPrecompSession';

export type LottiePrecompTabMode = 'main' | 'lot';

export type LottiePrecompTabConversion = {
  mode: LottiePrecompTabMode;
  lottiePrecompEdit: LottiePrecompEditState | null;
  focus: {
    active: boolean;
    lotNodeId: string | null;
    sessionMaterialized: false;
  };
};

function resolveLotNodeId(assetId: string): string | null {
  return (
    linkedLotNodeIdFromAsset(assetId) ||
    (assetId.startsWith('lot_') ? assetId.slice(4) : null)
  );
}

/** One method: main ↔ lot. Preview and edit share data + draw path. */
export function convertLottiePrecompTab(opts: {
  mode: LottiePrecompTabMode;
  hostNodeId?: string;
  assetId?: string;
  selectedLayerInd?: number | null;
}): LottiePrecompTabConversion {
  if (opts.mode === 'main') {
    return {
      mode: 'main',
      lottiePrecompEdit: null,
      focus: { active: false, lotNodeId: null, sessionMaterialized: false },
    };
  }

  const hostNodeId = String(opts.hostNodeId || '').trim();
  const assetId = String(opts.assetId || '').trim();
  const lotNodeId = assetId ? resolveLotNodeId(assetId) : null;
  const layerInd =
    opts.selectedLayerInd == null || !Number.isFinite(Number(opts.selectedLayerInd))
      ? null
      : Math.round(Number(opts.selectedLayerInd));

  return {
    mode: 'lot',
    lottiePrecompEdit: {
      hostNodeId,
      assetId,
      selectedLayerInd: layerInd,
      lotNodeId,
      sessionNodeIds: [],
      sessionHidesLotInk: false,
    },
    focus: {
      active: true,
      lotNodeId,
      sessionMaterialized: false,
    },
  };
}
