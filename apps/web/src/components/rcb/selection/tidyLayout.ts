export type TidyBox = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TidyPatch = {
  nodeId: string;
  patch: { x?: number; y?: number };
};

function centerY(b: TidyBox) {
  return b.top + b.height / 2;
}

function centerX(b: TidyBox) {
  return b.left + b.width / 2;
}

/** Group items into horizontal rows by vertical center proximity. */
function clusterRows(boxes: TidyBox[]): TidyBox[][] {
  if (boxes.length < 2) return [boxes];
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const avgH = sorted.reduce((sum, b) => sum + b.height, 0) / sorted.length;
  const threshold = Math.max(12, avgH * 0.55);

  const rows: TidyBox[][] = [];
  let row: TidyBox[] = [sorted[0]];
  let rowCy = centerY(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const cy = centerY(item);
    if (Math.abs(cy - rowCy) <= threshold) {
      row.push(item);
      rowCy = row.reduce((sum, b) => sum + centerY(b), 0) / row.length;
    } else {
      rows.push(row);
      row = [item];
      rowCy = cy;
    }
  }
  rows.push(row);
  return rows;
}

function pushIfChanged(
  out: Map<string, { x?: number; y?: number }>,
  id: string,
  patch: { x?: number; y?: number },
  prev: TidyBox
) {
  const merged = { ...out.get(id), ...patch };
  const nextX = merged.x ?? prev.left;
  const nextY = merged.y ?? prev.top;
  if (Math.round(nextX) === Math.round(prev.left) && Math.round(nextY) === Math.round(prev.top)) {
    out.delete(id);
    return;
  }
  out.set(id, merged);
}

function mapToPatches(out: Map<string, { x?: number; y?: number }>): TidyPatch[] {
  return [...out.entries()].map(([nodeId, patch]) => ({ nodeId, patch }));
}

/** Align cross-axis + even spacing along primary axis within one row/column. */
function tidyLine(boxes: TidyBox[], horizontal: boolean): TidyPatch[] {
  if (boxes.length < 2) return [];
  const sorted = [...boxes].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top));
  const out = new Map<string, { x?: number; y?: number }>();

  if (horizontal) {
    const minT = Math.min(...sorted.map((b) => b.top));
    const maxB = Math.max(...sorted.map((b) => b.top + b.height));
    const midY = (minT + maxB) / 2;
    for (const b of sorted) {
      pushIfChanged(out, b.id, { y: Math.round(midY - b.height / 2) }, b);
    }
    if (sorted.length >= 3) {
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalW = sorted.reduce((sum, b) => sum + b.width, 0);
      const span = last.left + last.width - first.left - totalW;
      const gap = span / (sorted.length - 1);
      let cursor = first.left + first.width + gap;
      for (let i = 1; i < sorted.length - 1; i++) {
        const b = sorted[i];
        pushIfChanged(out, b.id, { x: Math.round(cursor) }, b);
        cursor += b.width + gap;
      }
    }
    return mapToPatches(out);
  }

  const minL = Math.min(...sorted.map((b) => b.left));
  const maxR = Math.max(...sorted.map((b) => b.left + b.width));
  const midX = (minL + maxR) / 2;
  for (const b of sorted) {
    pushIfChanged(out, b.id, { x: Math.round(midX - b.width / 2) }, b);
  }
  if (sorted.length >= 3) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalH = sorted.reduce((sum, b) => sum + b.height, 0);
    const span = last.top + last.height - first.top - totalH;
    const gap = span / (sorted.length - 1);
    let cursor = first.top + first.height + gap;
    for (let i = 1; i < sorted.length - 1; i++) {
      const b = sorted[i];
      pushIfChanged(out, b.id, { y: Math.round(cursor) }, b);
      cursor += b.height + gap;
    }
  }
  return mapToPatches(out);
}

function resolvePrimaryHorizontal(boxes: TidyBox[]): boolean {
  const xs = boxes.map(centerX);
  const ys = boxes.map(centerY);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  return xSpread >= ySpread;
}

/**
 * Auto-tidy selection: align rows/columns and apply even spacing.
 * Works with 2+ items (unlike distribute which needs 3+ on one axis).
 */
export function tidyLayoutPatches(boxes: TidyBox[]): TidyPatch[] {
  if (boxes.length < 2) return [];

  const rows = clusterRows(boxes);
  if (rows.length === 1) {
    return tidyLine(rows[0], resolvePrimaryHorizontal(rows[0]));
  }

  const out = new Map<string, { x?: number; y?: number }>();
  const rowPatches: TidyPatch[][] = rows.map((row) => tidyLine(row, true));

  // Apply row tidies first so row bounds reflect aligned positions.
  const effective = new Map<string, TidyBox>();
  for (const b of boxes) effective.set(b.id, { ...b });
  for (const group of rowPatches) {
    for (const p of group) {
      const prev = effective.get(p.nodeId);
      if (!prev) continue;
      effective.set(p.nodeId, {
        ...prev,
        left: p.patch.x ?? prev.left,
        top: p.patch.y ?? prev.top,
      });
    }
  }
  for (const group of rowPatches) {
    for (const p of group) {
      pushIfChanged(out, p.nodeId, p.patch, boxes.find((b) => b.id === p.nodeId)!);
    }
  }

  const rowBounds = rows.map((row) => {
    const items = row.map((b) => effective.get(b.id) || b);
    const top = Math.min(...items.map((b) => b.top));
    const bottom = Math.max(...items.map((b) => b.top + b.height));
    const height = bottom - top;
    return { items, top, height };
  });

  if (rowBounds.length >= 3) {
    const first = rowBounds[0];
    const last = rowBounds[rowBounds.length - 1];
    const totalH = rowBounds.reduce((sum, row) => sum + row.height, 0);
    const span = last.top + last.height - first.top - totalH;
    const gap = span / (rowBounds.length - 1);
    let cursor = first.top + first.height + gap;
    for (let i = 1; i < rowBounds.length - 1; i++) {
      const row = rowBounds[i];
      const deltaY = Math.round(cursor - row.top);
      if (deltaY !== 0) {
        for (const b of row.items) {
          pushIfChanged(out, b.id, { y: b.top + deltaY }, b);
        }
      }
      cursor += row.height + gap;
    }
    return mapToPatches(out);
  }

  if (rowBounds.length === 2) {
    const [a, b] = rowBounds;
    const minT = Math.min(a.top, b.top);
    const maxB = Math.max(a.top + a.height, b.top + b.height);
    const midY = (minT + maxB) / 2;
    for (const row of rowBounds) {
      const rowCy = row.top + row.height / 2;
      const deltaY = Math.round(midY - rowCy);
      if (deltaY === 0) continue;
      for (const item of row.items) {
        pushIfChanged(out, item.id, { y: item.top + deltaY }, item);
      }
    }
  }

  return mapToPatches(out);
}
