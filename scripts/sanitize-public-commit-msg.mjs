#!/usr/bin/env node
/**
 * Sanitize a private commit message before publishing to the OSS repo.
 * Strips wording that reveals private→public mirroring.
 * Unwraps "Merge pull request #N" so the public history shows what changed.
 * Appends [skip ci] so zuoge does not re-run Actions on publish.
 *
 *   node scripts/sanitize-public-commit-msg.mjs < raw.txt > clean.txt
 */

const LEAK =
  /\b(sync(?:[-_\s]?public)?|mirror|recombyn-dev|Sync-source|open[- ]?source mirror|public mirror|OSS mirror)\b/gi;

const LEAK_ZH = /同步|镜像|私有仓库|公开镜像/;

/** @param {string} raw */
export function sanitizePublicCommitMessage(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return 'chore: update project\n\n[skip ci]';

  text = text
    .split('\n')
    .filter((line) => !/^\s*(Sync-source|Private-source|Mirror-of)\s*:/i.test(line))
    .join('\n')
    .trim();

  const lines = text.split('\n');
  let subject = (lines[0] || '').trim();
  let body = lines.slice(1).join('\n').trim();

  // Public history should describe the change, not the private PR merge wrapper.
  if (/^Merge (pull request|branch)\b/i.test(subject)) {
    const bodyLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^Merge (pull request|branch)\b/i.test(l));
    if (bodyLines.length) {
      subject = bodyLines[0];
      body = bodyLines.slice(1).join('\n').trim();
    } else {
      subject = 'chore: update project';
      body = '';
    }
  }

  subject = subject
    .replace(/^chore\s*\(\s*sync\s*\)\s*:?\s*/i, 'chore: ')
    .replace(/^sync\s*:?\s*/i, 'chore: ')
    .replace(/\bpublic\s+mirror\b/gi, 'project')
    .replace(/\bmirror\b/gi, 'project')
    .replace(/\bsync\b/gi, 'update')
    .replace(LEAK_ZH, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!subject || LEAK.test(subject) || LEAK_ZH.test(subject)) {
    subject = 'chore: update project';
  }

  body = body
    .replace(LEAK, '')
    .replace(LEAK_ZH, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let out = !body || /^[\s.·\-–—]*$/.test(body) ? subject : `${subject}\n\n${body}`;
  if (!/\[skip\s*ci\]|\[ci\s*skip\]/i.test(out)) {
    out = `${out.trim()}\n\n[skip ci]`;
  }
  return out;
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const input = Buffer.concat(chunks).toString('utf8');
  process.stdout.write(`${sanitizePublicCommitMessage(input)}\n`);
}

const isCli =
  process.argv[1] &&
  (process.argv[1].endsWith('sanitize-public-commit-msg.mjs') ||
    process.argv[1].endsWith('sanitize-public-commit-msg.js'));

if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
