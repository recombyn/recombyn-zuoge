/**
 * Rebuild IMPORT_*_scene.json from saved *_ops.json (importable SceneDocument).
 * Usage: node scripts/rebuild-import-scenes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, '.tmp-agent-export');

// Reuse helpers by evaluating the smoke script's functions via dynamic import is hard
// (script runs cases on load). Inline a minimal port:
function parseSize(raw) {
  const m = String(raw || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (!m) return { w: 1080, h: 1920 };
  return { w: Number(m[1]) || 1080, h: Number(m[2]) || 1920 };
}

function nodeFromOp(op, i, frameId) {
  const name = String(op.name || op.op_key || '');
  const a = op.args || {};
  const id = String(a.id || a.node_id || `n_${i}`);
  const x = Number(a.x ?? 0);
  const y = Number(a.y ?? 0);
  const w = Number(a.width ?? a.w ?? 200);
  const h = Number(a.height ?? a.h ?? 40);
  const base = { id, x, y, width: w, height: h, frameId };
  if (name === 'create_text') {
    return {
      ...base,
      key: 'text',
      attrs: {
        text: String(a.text || ''),
        fill: String(a.fill || '#111827'),
        fontSize: Number(a.fontSize || a.font_size || 16),
        fontWeight: Number(a.fontWeight || a.font_weight || 400),
        fontFamily: a.fontFamily || a.font_family || undefined,
      },
    };
  }
  if (name === 'create_image') {
    return {
      ...base,
      key: 'image',
      attrs: {
        src: String(a.src || a.url || '').trim(),
        genPrompt: a.genPrompt || a.prompt || undefined,
        name: a.name || 'Image',
        mode: a.mode || 'FILL',
      },
    };
  }
  if (name === 'create_shape' || name === 'create_rect') {
    return {
      ...base,
      key: 'shape',
      attrs: {
        fill: String(a.fill || '#e2e8f0'),
        cornerRadius: a.cornerRadius ?? a.radius ?? 0,
        opacity: a.opacity,
        shapeType: a.shapeType || a.shape_type || 'rect',
      },
    };
  }
  return null;
}

function documentFromOps(ops, canvasSize, title) {
  const { w, h } = parseSize(canvasSize);
  let fw = w;
  let fh = h;
  let fid = 'frame_main';
  const nodes = [];
  for (let i = 0; i < (ops || []).length; i++) {
    const op = ops[i];
    const name = String(op.name || op.op_key || '');
    const a = op.args || {};
    if (name === 'create_frame' || name === 'ensure_frame') {
      fid = String(a.id || a.frame_id || fid);
      fw = Number(a.width || a.w || fw) || fw;
      fh = Number(a.height || a.h || fh) || fh;
      continue;
    }
    const n = nodeFromOp(op, i, fid);
    if (n) nodes.push(n);
  }
  if (!nodes.length) throw new Error('no drawable ops');
  const delta = { ROOT: { id: 'ROOT', key: 'entry', children: nodes.map((n) => n.id) } };
  for (const n of nodes) {
    const { frameId: _f, ...rest } = n;
    delta[n.id] = rest;
  }
  return {
    width: fw,
    height: fh,
    backgroundColor: '#ffffff',
    frames: [
      {
        id: fid,
        name: title || 'Board',
        x: 0,
        y: 0,
        width: fw,
        height: fh,
        backgroundColor: '#ffffff',
      },
    ],
    activeFrameId: fid,
    deltaSetLike: delta,
  };
}

const jobs = [
  {
    ops: 'IMPORT_no_ref_ops.json',
    meta: '2026-08-25T14-02-26-875Z_no_ref_meta.json',
    out: 'IMPORT_no_ref_scene.json',
    fallbackSize: '1080x1920',
    title: 'Agent No-Ref Poster',
  },
  {
    ops: 'IMPORT_with_ref_ops.json',
    meta: '2026-08-25T14-41-47-862Z_with_ref_meta.json',
    out: 'IMPORT_with_ref_scene.json',
    fallbackSize: '390x844',
    title: 'Agent With-Ref Mobile',
  },
];

for (const j of jobs) {
  const opsPath = path.join(outDir, j.ops);
  if (!fs.existsSync(opsPath)) {
    console.warn('skip missing', opsPath);
    continue;
  }
  const { ops } = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
  let size = j.fallbackSize;
  let title = j.title;
  const metaPath = path.join(outDir, j.meta);
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.canvas_size) size = meta.canvas_size;
    if (meta.title) title = meta.title;
  }
  const doc = documentFromOps(ops, size, title);
  const outPath = path.join(outDir, j.out);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8');
  console.log('wrote', outPath, 'nodes=', Object.keys(doc.deltaSetLike).length - 1);
}

// Also build puppy scene if hydrate src present in puppy retest ops
const puppy = path.join(outDir, '2026-08-25T15-33-30-697Z_puppy_retest.json');
if (fs.existsSync(puppy)) {
  const raw = JSON.parse(fs.readFileSync(puppy, 'utf8'));
  const ops = raw.ops || [];
  if (ops.length) {
    const doc = documentFromOps(ops, '800x800', 'Puppy');
    const outPath = path.join(outDir, 'IMPORT_puppy_scene.json');
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8');
    console.log('wrote', outPath, 'nodes=', Object.keys(doc.deltaSetLike).length - 1);
  }
}
