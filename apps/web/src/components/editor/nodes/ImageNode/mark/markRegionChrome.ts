type MarkChromeTone = 'draft' | 'selected' | 'hovered' | 'idle' | 'pinned' | 'pinnedExpanded';

function resolveTone(opts: {
  draft?: boolean;
  selected?: boolean;
  hovered?: boolean;
  expanded?: boolean;
  pinned?: boolean;
}): MarkChromeTone {
  if (opts.draft) return 'draft';
  if (opts.expanded) return 'pinnedExpanded';
  if (opts.pinned) return 'pinned';
  if (opts.selected) return 'selected';
  if (opts.hovered) return 'hovered';
  return 'idle';
}

const BORDER: Record<MarkChromeTone, string> = {
  draft: 'rgba(37,99,235,0.95)',
  selected: 'rgba(59,130,246,0.95)',
  hovered: 'rgba(96,165,250,0.9)',
  idle: 'rgba(59,130,246,0.55)',
  pinned: 'rgba(59,130,246,0.55)',
  pinnedExpanded: 'rgba(59,130,246,0.95)',
};

const FILL: Record<MarkChromeTone, string> = {
  draft: 'inset 0 0 0 9999px rgba(59,130,246,0.16)',
  selected: 'inset 0 0 0 9999px rgba(59,130,246,0.16)',
  hovered: 'inset 0 0 0 9999px rgba(59,130,246,0.08)',
  idle: 'inset 0 0 0 9999px rgba(59,130,246,0.04)',
  pinned: 'inset 0 0 0 9999px rgba(59,130,246,0.04)',
  pinnedExpanded: 'inset 0 0 0 9999px rgba(59,130,246,0.16)',
};

const BADGE: Record<MarkChromeTone, string> = {
  draft: '#2563eb',
  selected: '#2563eb',
  hovered: '#60a5fa',
  idle: '#60a5fa',
  pinned: '#60a5fa',
  pinnedExpanded: '#2563eb',
};

export function markRegionChrome(opts: {
  draft?: boolean;
  selected?: boolean;
  hovered?: boolean;
  expanded?: boolean;
  pinned?: boolean;
}) {
  const tone = resolveTone(opts);
  const borderWidth = opts.draft || opts.expanded ? 2 : 1.5;
  const boxShadow = opts.selected
    ? `0 0 0 1px rgba(59,130,246,0.35), ${FILL[tone]}`
    : FILL[tone];

  return {
    border: `${borderWidth}px dashed ${BORDER[tone]}`,
    boxShadow,
    badgeBg: BADGE[tone],
    cursor: opts.expanded ? 'default' : 'pointer',
  };
}
