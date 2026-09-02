/**
 * Lightweight markdown helpers for scene text nodes.
 * Canvas text renders plain text; `attrs.markdown` keeps the source.
 */

export function markdownToPlain(md: string): string {
  let s = String(md || '');
  // code fences → inner text
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');
  // images ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  // links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // headings
  s = s.replace(/^#{1,6}\s+/gm, '');
  // blockquote
  s = s.replace(/^>\s?/gm, '');
  // unordered / ordered lists
  s = s.replace(/^[\t ]*[-*+]\s+/gm, '• ');
  s = s.replace(/^[\t ]*\d+\.\s+/gm, '');
  // bold / italic / strike / code
  s = s.replace(/\*\*(.+?)\*\*/g, '$1');
  s = s.replace(/__(.+?)__/g, '$1');
  s = s.replace(/\*(.+?)\*/g, '$1');
  s = s.replace(/_(.+?)_/g, '$1');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/`([^`]+)`/g, '$1');
  // horizontal rules
  s = s.replace(/^(-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  return s.replace(/\n{3,}/g, '\n\n').trimEnd();
}
