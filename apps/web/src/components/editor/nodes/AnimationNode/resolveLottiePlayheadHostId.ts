/** Host driving canvas playhead: dock panel, else undocked play session. */
export function resolveLottiePlayheadHostId(editor: {
  lottieTimelinePanel?: { nodeId?: string } | null;
  lottiePlayingHostId?: string | null;
}): string {
  const fromPanel = String(editor?.lottieTimelinePanel?.nodeId || '').trim();
  if (fromPanel) return fromPanel;
  return String(editor?.lottiePlayingHostId || '').trim();
}
