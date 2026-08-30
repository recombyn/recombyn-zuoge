import { useEffect, useState, type RefObject } from 'react';
import { getLayerDockWidth } from '@/components/editor/panels/LayerPanel';
import { getAgentDockWidth } from '@/components/editor/panels/AgentDock';
import { getInspectDockWidth } from '@/components/editor/panels/DevPropertiesPanel';

/** Shared screen-px inset from the stage edge. */
export const HUD_EDGE_INSET_PX = 16;

const TOOLS_GAP_PX = 12;
const LEFT_DOCK = '[data-editor-left-dock]';
const RIGHT_DOCK = '[data-editor-right-dock]';

/** Observe an overlay dock's width (0 when closed). */
function useObservedDockWidth(
  open: boolean,
  selector: string,
  fallbackWidth: number
): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!open) {
      setWidth(0);
      return;
    }

    const sync = () => {
      const panel = window.document.querySelector(selector) as HTMLElement | null;
      setWidth(panel ? Math.round(panel.getBoundingClientRect().width) : fallbackWidth);
    };
    sync();

    let observer: ResizeObserver | null = null;
    const attach = () => {
      const panel = window.document.querySelector(selector) as HTMLElement | null;
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
  }, [open, selector, fallbackWidth]);

  return width;
}

export function useLeftDockWidth(layersOpen: boolean): number {
  return useObservedDockWidth(layersOpen, LEFT_DOCK, getLayerDockWidth());
}

export function useRightDockWidth(
  agentOpen: boolean,
  inspectOpen: boolean,
  workspaceMode: 'design' | 'dev'
): number {
  const open = workspaceMode === 'dev' ? inspectOpen : agentOpen;
  const fallback =
    workspaceMode === 'dev' ? getInspectDockWidth() : getAgentDockWidth();
  return useObservedDockWidth(open, RIGHT_DOCK, fallback);
}

export function useLeftDockInset(layersOpen: boolean): number {
  return useLeftDockWidth(layersOpen) + HUD_EDGE_INSET_PX;
}

export function useRightDockInset(
  agentOpen: boolean,
  inspectOpen: boolean,
  workspaceMode: 'design' | 'dev'
): number {
  return useRightDockWidth(agentOpen, inspectOpen, workspaceMode) + HUD_EDGE_INSET_PX;
}

export function useBottomHudStackState(opts: {
  stageEl: HTMLElement | null;
  hudRef: RefObject<HTMLDivElement | null>;
  leftHudInsetPx: number;
  layersOpen: boolean;
}): boolean {
  const { stageEl, hudRef, leftHudInsetPx, layersOpen } = opts;
  const [stackBottomHud, setStackBottomHud] = useState(false);

  useEffect(() => {
    const stage = stageEl;
    const hud = hudRef.current;
    const tools = stage?.ownerDocument?.querySelector(
      '[data-tour="editor-tools"]'
    ) as HTMLElement | null;
    if (!stage || !hud || !tools) {
      setStackBottomHud(false);
      return;
    }

    const measure = () => {
      if (layersOpen) {
        setStackBottomHud(false);
        return;
      }
      const stageBox = stage.getBoundingClientRect();
      const hudBox = hud.getBoundingClientRect();
      const toolsBox = tools.getBoundingClientRect();
      if (!(hudBox.width > 0) || !(toolsBox.width > 0) || !(stageBox.width > 0)) {
        setStackBottomHud(false);
        return;
      }
      const hudRight = stageBox.left + leftHudInsetPx + hudBox.width;
      setStackBottomHud(hudRight + TOOLS_GAP_PX > toolsBox.left);
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
  }, [stageEl, hudRef, leftHudInsetPx, layersOpen]);

  return stackBottomHud;
}
