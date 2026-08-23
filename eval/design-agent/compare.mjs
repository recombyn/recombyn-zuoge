/**
 * PR19 — Skill eval regression compare.
 *
 *   node eval/design-agent/compare.mjs
 *   node eval/design-agent/compare.mjs --current eval/design-agent/results/latest.json
 *
 * FAIL if average drop > thresholds.avg_drop (default 3)
 *      or any key-task drop > thresholds.key_task_drop (default 5).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractTasks,
  loadSkillVersions,
} from '../../packages/eval-framework/src/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(path.dirname(here));

function argValue(argv, flag, fallback) {
  const hit = argv.find((a) => a.startsWith(`${flag}=`));
  if (hit) return hit.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const FAMILY_SKILL = {
  poster: 'poster_craft',
  landing: 'landing_page',
  dashboard: 'dashboard_ui',
  image: 'image_gen',
};

function skillForTask(id) {
  const fam = String(id).split('-')[0];
  return FAMILY_SKILL[fam] || '';
}

function compareEval(baselineDoc, currentDoc, skillVersions) {
  const thresholds = baselineDoc?.thresholds || {};
  const avgDropMax = Number(thresholds.avg_drop ?? 3);
  const keyDropMax = Number(thresholds.key_task_drop ?? 5);
  const keyTasks = Array.isArray(baselineDoc?.key_tasks)
    ? baselineDoc.key_tasks.map(String)
    : ['poster-001', 'landing-001', 'dashboard-001', 'image-001'];
  const baselineTasks = extractTasks(baselineDoc);
  const currentTasks = extractTasks(currentDoc);
  const shared = Object.keys(baselineTasks).filter((id) => currentTasks[id]);
  const taskRows = shared
    .sort()
    .map((id) => {
      const base = baselineTasks[id].score;
      const score = currentTasks[id].score;
      const skill = skillForTask(id);
      return {
        id,
        skill,
        skill_version: skillVersions[skill] || '',
        model: currentTasks[id].model || currentDoc.model || baselineDoc.model || 'auto',
        score,
        baseline: base,
        delta: score - base,
        issues: currentTasks[id].issues,
      };
    });
  const avgBaseline = mean(taskRows.map((r) => r.baseline));
  const avgCurrent = mean(taskRows.map((r) => r.score));
  const avgDrop = avgBaseline == null || avgCurrent == null ? null : avgBaseline - avgCurrent;
  const reasons = [];
  if (avgDrop != null && avgDrop > avgDropMax) {
    reasons.push(`avg_drop ${avgDrop.toFixed(2)} > ${avgDropMax}`);
  }
  for (const id of keyTasks) {
    const row = taskRows.find((r) => r.id === id);
    if (!row) {
      if (baselineTasks[id] && !currentTasks[id]) {
        reasons.push(`key_task ${id} missing from current`);
      }
      continue;
    }
    const drop = row.baseline - row.score;
    if (drop > keyDropMax) {
      reasons.push(`key_task ${id} drop ${drop.toFixed(2)} > ${keyDropMax}`);
    }
  }
  return {
    skill_versions: skillVersions,
    model: currentDoc.model || baselineDoc.model || taskRows[0]?.model || 'auto',
    thresholds: { avg_drop: avgDropMax, key_task_drop: keyDropMax },
    key_tasks: keyTasks,
    compared: shared.length,
    avg_baseline: avgBaseline,
    avg_current: avgCurrent,
    avg_drop: avgDrop,
    tasks: taskRows,
    fail: reasons.length > 0,
    reasons,
    skipped: shared.length === 0,
  };
}

const argv = process.argv.slice(2);
const baselinePath = path.resolve(
  argValue(argv, '--baseline', path.join(here, 'baseline.json'))
);
const currentPath = path.resolve(
  argValue(argv, '--current', path.join(here, 'results', 'latest.json'))
);
const outPath = path.resolve(
  argValue(argv, '--out', path.join(here, 'results', 'compare.json'))
);
const requireCurrent = argv.includes('--require-current');

if (!fs.existsSync(baselinePath)) {
  console.error(`missing baseline: ${baselinePath}`);
  process.exit(2);
}
if (!fs.existsSync(currentPath)) {
  console.error(`missing current: ${currentPath}`);
  process.exit(requireCurrent ? 2 : 0);
}

const baselineDoc = readJson(baselinePath);
const currentDoc = readJson(currentPath);
const skillVersions = loadSkillVersions(repoRoot);
const report = compareEval(baselineDoc, currentDoc, skillVersions);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
// Tests parse stdout as JSON; human status goes to stderr.
process.stdout.write(`${JSON.stringify(report)}\n`);
console.error(
  report.fail
    ? `FAIL compare → ${outPath}`
    : report.skipped
      ? `SKIP compare (no shared tasks) → ${outPath}`
      : `PASS compare → ${outPath}`
);
if (report.reasons?.length) {
  for (const reason of report.reasons) console.error(`- ${reason}`);
}
process.exit(report.fail ? 1 : 0);
