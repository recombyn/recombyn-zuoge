/** Cross-tab probe: is this project open in another editor tab? */

const CHANNEL = 'recombyn-open-projects';
const PROBE_TIMEOUT_MS = 120;

type CheckMsg = { type: 'check'; projectId: string; requestId: string };
type EditingMsg = { type: 'editing'; projectId: string; requestId: string };

let channel: BroadcastChannel | null = null;

function channelOrNull(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

function isCheckFor(msg: unknown, projectId: string): msg is CheckMsg {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as CheckMsg).type === 'check' &&
    (msg as CheckMsg).projectId === projectId
  );
}

function isEditingReply(msg: unknown, projectId: string, requestId: string): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as EditingMsg).type === 'editing' &&
    (msg as EditingMsg).projectId === projectId &&
    (msg as EditingMsg).requestId === requestId
  );
}

/** EditorPage: answer delete probes from home / projects list. */
export function listenForProjectOpenProbes(projectId: string | null | undefined): () => void {
  const id = String(projectId || '').trim();
  const ch = channelOrNull();
  if (!id || !ch) return () => {};

  const onMessage = (event: MessageEvent<CheckMsg>) => {
    const msg = event.data;
    if (!isCheckFor(msg, id)) return;
    ch.postMessage({ type: 'editing', projectId: id, requestId: msg.requestId });
  };

  ch.addEventListener('message', onMessage);
  return () => ch.removeEventListener('message', onMessage);
}

/** True when another tab has this project open in the editor. */
export function probeProjectOpenElsewhere(projectId: string): Promise<boolean> {
  const id = String(projectId || '').trim();
  const ch = channelOrNull();
  if (!id || !ch) return Promise.resolve(false);

  const requestId = crypto.randomUUID();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      ch.removeEventListener('message', onReply);
      clearTimeout(timer);
      resolve(open);
    };

    const onReply = (event: MessageEvent<EditingMsg>) => {
      if (isEditingReply(event.data, id, requestId)) finish(true);
    };

    ch.addEventListener('message', onReply);
    ch.postMessage({ type: 'check', projectId: id, requestId });
    const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
  });
}
