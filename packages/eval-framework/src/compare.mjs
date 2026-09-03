/**
 * Open eval compare helpers (suite data lives under eval/design-agent/).
 */
import fs from 'node:fs';
import path from 'node:path';

export function asScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function taskIdFromRow(row) {
  if (row?.caseId) return String(row.caseId);
  const raw = String(row?.id || '');
  return raw.includes('@') ? raw.split('@')[0] : raw;
}

export function issuesFromRow(row) {
  const review = row?.review && typeof row.review === 'object' ? row.review : {};
  const list = row?.issues || review.issues || [];
  return Array.isArray(list) ? list.slice(0, 8).map((x) => String(x)) : [];
}

export function extractTasks(doc) {
  const out = {};
  const compact = doc?.tasks;
  if (compact && typeof compact === 'object' && !Array.isArray(compact)) {
    for (const [id, row] of Object.entries(compact)) {
      const score = asScore(row?.score ?? row?.total);
      if (!id || score == null) continue;
      out[id] = {
        score,
        issues: issuesFromRow(row),
        model: row?.model || doc.model || null,
      };
    }
    return out;
  }
  for (const row of doc?.results || []) {
    const id = taskIdFromRow(row);
    const score = asScore(row?.review?.total ?? row?.total ?? row?.score);
    if (!id || score == null) continue;
    out[id] = {
      score,
      issues: issuesFromRow(row),
      model: row?.model || doc.model || null,
    };
  }
  return out;
}

/** Resolve skill pack version from open `skills/`. */
export function loadSkillVersions(repoRoot, keys = ['poster_craft', 'landing_page', 'dashboard_ui', 'image_gen']) {
  const roots = [
    path.join(repoRoot, 'skills', 'foundation'),
    path.join(repoRoot, 'skills', 'domains'),
  ];
  const versions = {};
  for (const key of keys) {
    let found = null;
    for (const root of roots) {
      const metaPath = path.join(root, key, '_meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        found = meta.version || meta.skill_version || null;
        break;
      } catch {
        found = null;
      }
    }
    versions[key] = found;
  }
  return versions;
}

export function compareRuns({
  baselineTasks,
  currentTasks,
  thresholds = { avg_drop: 3, key_task_drop: 5 },
  keyTasks = [],
}) {
  const avgDropMax = Number(thresholds.avg_drop ?? 3);
  const keyDropMax = Number(thresholds.key_task_drop ?? 5);
  const ids = Object.keys(baselineTasks).filter((id) => currentTasks[id]);
  const deltas = [];
  let sumDrop = 0;
  const keyFails = [];
  for (const id of ids) {
    const before = baselineTasks[id].score;
    const after = currentTasks[id].score;
    const drop = before - after;
    deltas.push({ id, before, after, drop });
    sumDrop += drop;
    if (keyTasks.includes(id) && drop > keyDropMax) {
      keyFails.push({ id, before, after, drop });
    }
  }
  const avgDrop = ids.length ? sumDrop / ids.length : 0;
  const pass = avgDrop <= avgDropMax && keyFails.length === 0;
  return {
    pass,
    avgDrop,
    avgDropMax,
    keyDropMax,
    compared: ids.length,
    keyFails,
    deltas,
  };
}
