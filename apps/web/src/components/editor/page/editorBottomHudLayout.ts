import { useEffect, useState, type RefObject } from 'react';
import { getAssetDockWidth } from '@/components/editor/panels/AssetPanel';
import { getLayerDockWidth } from '@/components/editor/panels/LayerPanel';

/** Shared screen-px inset from the stage edge. */
export const HUD_EDGE_INSET_PX = 16;

/** Min gap between left HUD and centered toolstrip before stacking. */
export const BOTTOM_HUD_TOOLS_GAP_PX = 12;

const LEFT_DOCK_SELECTOR = '[data-editor-left-dock]';

function queryLeftDockPanel(): HTMLElement | null {
  return window.document.querySelector(LEFT_DOCK_SELECTOR) as HTMLElement | null;
}

export function readLeftDockInsetPx(layersOpen: boolean, assetsOpen: boolean): number {
  if (!layersOpen && !assetsOpen) return HUD_EDGE_INSET_PX;
  const panel = queryLeftDockPanel();
  if (panel) return Math.round(panel.getBoundingClientRect().width) + HUD_EDGE_INSET_PX;
  const dockW = layersOpen ? getLayerDockWidth() : getAssetDockWidth();
  return dockW + HUD_EDGE_INSET_PX;
}

export function bottomHudCollidesWithTools(opts: {
  stage: DOMRect;
  hudLeftPx: number;
  hudWidth: number;
  toolsWidth: number;
}): boolean {
  const { stage, hudLeftPx, hudWidth, toolsWidth } = opts;
  if (!(hudWidth > 0) || !(toolsWidth > 0) || !(stage.width > 0)) return false;
  const hudRight = stage.left + hudLeftPx + hudWidth;
  const toolsLeft = stage.left + stage.width / 2 - toolsWidth / 2;
  return hudRight + BOTTOM_HUD_TOOLS_GAP_PX > toolsLeft;
}

export function useLeftDockInset(layersOpen: boolean, assetsOpen: boolean): number {
  const [leftHudInsetPx, setLeftHudInsetPx] = useState(HUD_EDGE_INSET_PX);

  useEffect(() => {
    if (!layersOpen && !assetsOpen) {
      setLeftHudInsetPx(HUD_EDGE_INSET_PX);
      return undefined;
    }

    const sync = () => setLeftHudInsetPx(readLeftDockInsetPx(layersOpen, assetsOpen));
    sync();

    let observer: ResizeObserver | null = null;
    const attach = () => {
      const panel = queryLeftDockPanel();
      if (!panel) return;
      observer?.disconnect();
      observer = new ResizeObserver(sync);
      observer.observe(panel);
    };

    attach();
    const raf = window.requestAnimationFrame(attach);
    window.addEventListener('resize', sync);

    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [layersOpen, assetsOpen]);

  return leftHudInsetPx;
}

export function useBottomHudStackState(opts: {
  stageEl: HTMLElement | null;
  hudRef: RefObject<HTMLDivElement | null>;
  leftHudInsetPx: number;
  layersOpen: boolean;
  assetsOpen: boolean;
}): boolean {
  const { stageEl, hudRef, leftHudInsetPx, layersOpen, assetsOpen } = opts;
  const [stackBottomHud, setStackBottomHud] = useState(false);
  const leftDockOpen = layersOpen || assetsOpen;

  useEffect(() => {
    const stage = stageEl;
    const hud = hudRef.current;
    const tools = stage?.ownerDocument?.querySelector(
      '[data-tour="editor-tools"]'
    ) as HTMLElement | null;

    if (!stage || !hud || !tools) {
      setStackBottomHud(false);
      return undefined;
    }

    const measure = () => {
      if (leftDockOpen) {
        setStackBottomHud(false);
        return;
      }
      const stageBox = stage.getBoundingClientRect();
      const hudBox = hud.getBoundingClientRect();
      const toolsBox = tools.getBoundingClientRect();
      setStackBottomHud(
        bottomHudCollidesWithTools({
          stage: stageBox,
          hudLeftPx: leftHudInsetPx,
          hudWidth: hudBox.width,
          toolsWidth: toolsBox.width,
        })
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    observer.observe(hud);
    observer.observe(tools);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [stageEl, hudRef, leftHudInsetPx, leftDockOpen]);

  return stackBottomHud;
}
