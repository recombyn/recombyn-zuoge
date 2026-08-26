/**
 * Live editor bridge for MCP canvas control:
 * - heartbeat → server routes ops to live queue (full designTools parity)
 * - pending batches → executeDesignToolAsync
 * - revision fallback reload when headless writes land
 */
import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { SceneDocument } from '@/components/rcb/sceneNode';
import {
  executeDesignToolAsync,
  type DesignToolContext,
} from '@/components/editor/panels/agent/designTools';
import { importDocument, pushEditorHistory } from '@/store/modules/editor';
import {
  fetchProject,
} from '@/service/projects';
import {
  mcpCanvasAckPending,
  mcpCanvasFetchPending,
  mcpCanvasHeartbeat,
} from '@/service/mcpCanvas';

type Props = {
  projectId: string | null | undefined;
  enabled?: boolean;
  heartbeatMs?: number;
  pollMs?: number;
};

export function McpCanvasBridge({
  projectId,
  enabled = true,
  heartbeatMs = 4000,
  pollMs = 1500,
}: Props) {
  const dispatch = useDispatch();
  const document = useSelector((state: any) => state.editor.document as SceneDocument | null);
  const activeFrameId = useSelector(
    (state: any) => state.editor.document?.activeFrameId as string | null | undefined
  );
  const lastRev = useRef<number | null>(null);
  const applying = useRef(false);

  const buildCtx = useCallback((): DesignToolContext | null => {
    if (!document) return null;
    return {
      dispatch,
      getDocument: () => document,
      targetFrameId: activeFrameId || null,
      allowDestructive: true,
      skipHistory: false,
    };
  }, [dispatch, document, activeFrameId]);

  const reloadIfRevisionBumped = useCallback(async (pid: string) => {
    try {
      const row = await fetchProject(pid);
      const proj = row?.project;
      const rev = Number(proj?.revision);
      if (!Number.isFinite(rev)) return;
      if (lastRev.current == null) {
        lastRev.current = rev;
        return;
      }
      if (rev > lastRev.current && proj?.document) {
        lastRev.current = rev;
        dispatch(
          importDocument({
            id: pid,
            name: proj.name || 'Untitled',
            document: proj.document,
            source: 'user',
          })
        );
      }
    } catch {
      /* ignore */
    }
  }, [dispatch]);

  const applyPending = useCallback(async (pid: string) => {
    if (applying.current) return;
    const ctx = buildCtx();
    if (!ctx) return;
    applying.current = true;
    try {
      const batches = await mcpCanvasFetchPending(pid, 8);
      if (!batches.length) return;
      const ackIds: string[] = [];
      for (const batch of batches) {
        const bid = String(batch.batchId || '').trim();
        const ops = Array.isArray(batch.ops) ? batch.ops : [];
        for (const op of ops) {
          const name = String(op?.name || '').trim();
          if (!name) continue;
          const args = (op?.args && typeof op.args === 'object' ? op.args : {}) as Record<
            string,
            unknown
          >;
          dispatch(pushEditorHistory());
          await executeDesignToolAsync(name, JSON.stringify(args), ctx);
        }
        if (bid) ackIds.push(bid);
      }
      if (ackIds.length) {
        await mcpCanvasAckPending(pid, ackIds);
      }
    } finally {
      applying.current = false;
    }
  }, [buildCtx, dispatch]);

  useEffect(() => {
    const pid = String(projectId || '').trim();
    if (!enabled || !pid) return;

    let cancelled = false;

    const heartbeat = async () => {
      try {
        await mcpCanvasHeartbeat(pid);
      } catch {
        /* MCP disabled or offline */
      }
    };

    const tick = async () => {
      if (cancelled) return;
      await heartbeat();
      await applyPending(pid);
      await reloadIfRevisionBumped(pid);
    };

    void tick();
    const hb = window.setInterval(() => void heartbeat(), heartbeatMs);
    const poll = window.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(hb);
      window.clearInterval(poll);
    };
  }, [projectId, enabled, heartbeatMs, pollMs, applyPending, reloadIfRevisionBumped]);

  return null;
}
