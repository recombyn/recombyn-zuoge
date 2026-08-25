/** Tree-shaped font catalog loader. */

import { apiQuery, queryClient } from '@/service/client';
import { getToken } from '@/utils/token';
import type { FontChild, FontFaceFormat, FontFamilyNode, FontWeightOption } from './fontCatalogTypes';

export type { FontChild, FontFaceFormat, FontFamilyNode, FontWeightOption } from './fontCatalogTypes';

const STYLE_ID = 'resume-dynamic-fonts';

let catalogCache: FontFamilyNode[] | null = null;
let catalogAuthKey: string | null = null;
let loadPromise: Promise<FontFamilyNode[]> | null = null;
let facesInjected = false;

function currentCatalogAuthKey(): string {
  return getToken() ? 'authed' : 'anon';
}

function fontsQueryOptions() {
  return apiQuery.fontsListFontsEndpoint.queryOptions({
    input: { query: { page: 1, pageSize: 500 } },
  });
}

function isFontsQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey.some((k) => typeof k === 'string' && k.includes('fonts'));
}

function normalizeCatalog(raw: unknown): FontFamilyNode[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((item) => {
      const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const childrenRaw = rec.children;
      return {
        family: String(rec.family || ''),
        displayName: String(rec.displayName || rec.family || ''),
        url: rec.url ? String(rec.url) : undefined,
        format: rec.format as FontFaceFormat | undefined,
        isMine: Boolean(rec.isMine),
        ownerUserId: rec.ownerUserId ? String(rec.ownerUserId) : null,
        children: Array.isArray(childrenRaw)
          ? childrenRaw
              .map((c) => {
                const child = c && typeof c === 'object' ? (c as Record<string, unknown>) : {};
                return {
                  family: String(child.family || rec.family || ''),
                  displayName: String(child.displayName || 'Regular'),
                  url: child.url ? String(child.url) : undefined,
                  format: child.format as FontFaceFormat | undefined,
                  weight: Number.isFinite(Number(child.weight)) ? Number(child.weight) : undefined,
                };
              })
              .filter((c: { url?: string }) => Boolean(c.url))
          : [],
      };
    })
    .filter((f) => f.family);
}

function resolveFontUrl(url: string) {
  if (/^(https?:|data:|blob:)/i.test(url) || url.startsWith('/')) return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function numericFontWeight(fontWeight: string | number | undefined): number {
  if (fontWeight === 'bold' || fontWeight === '700') return 700;
  if (fontWeight === 'normal' || fontWeight === '400') return 400;
  return Number(fontWeight);
}

/** Absolute URL for a catalog face (for @font-face / fontkit outline). */
export function resolveFontFileUrl(
  fontFamily: string,
  fontWeight?: string | number,
  catalog = getFontCatalogSync()
): string | null {
  const children = getFontChildren(fontFamily, catalog);
  const numeric = numericFontWeight(fontWeight);

  if (children.length) {
    const exact = children.filter((c) => c.family === fontFamily && c.url);
    // Unique face name (… Bold) — that file only; never pick sibling Regular by CSS weight.
    // Exception: base Regular + CSS bold/700 → Bold sibling (B button / outline must match paint).
    if (exact.length === 1) {
      const face = exact[0];
      if (Number.isFinite(numeric) && numeric >= 600 && (face.weight ?? 400) < 600) {
        const bold =
          children.find((c) => (c.weight ?? 0) >= 600 && c.url) ||
          children.find((c) => /bold/i.test(c.family) && c.url);
        if (bold?.url) return resolveFontUrl(bold.url);
      }
      return resolveFontUrl(face.url!);
    }
    // Shared CSS family — pick by weight axis.
    if (exact.length > 1 && Number.isFinite(numeric)) {
      const byW = exact.find((c) => c.weight === numeric);
      if (byW?.url) return resolveFontUrl(byW.url);
      return resolveFontUrl(exact[0].url!);
    }
    if (Number.isFinite(numeric)) {
      const byW = children.find((c) => c.weight === numeric && c.url);
      if (byW?.url) return resolveFontUrl(byW.url);
    }
    const face = findFontChild(fontFamily, catalog);
    if (face?.url) return resolveFontUrl(face.url);
    const withUrl = children.find((c) => c.url);
    if (withUrl?.url) return resolveFontUrl(withUrl.url);
  }

  const node = findFontFamily(fontFamily, catalog);
  if (node?.url) return resolveFontUrl(node.url);
  return null;
}

function formatHint(format?: FontFaceFormat, url?: string): FontFaceFormat {
  if (format) return format;
  if (url?.includes('.woff2')) return 'woff2';
  if (url?.includes('.woff')) return 'woff';
  if (url?.includes('.otf')) return 'opentype';
  return 'truetype';
}

/** Inject @font-face for catalog entries that declare a `url`. */
export function injectFontFaces(catalog: FontFamilyNode[], opts?: { force?: boolean }) {
  if (typeof document === 'undefined') return;
  if (facesInjected && !opts?.force) return;
  const rules: string[] = [];

  catalog.forEach((font) => {
    if (font.children?.length) {
      font.children.forEach((child) => {
        if (!child.url) return;
        const src = resolveFontUrl(child.url);
        const fmt = formatHint(child.format, child.url);
        // Unique face names (… Bold) use weight 400 so canvas `normal` matches the file;
        // shared family names keep the real weight axis.
        const shared =
          font.children!.filter((c) => c.family === child.family && c.url).length > 1;
        const faceWeight = shared ? (child.weight ?? 400) : 400;
        rules.push(
          `@font-face{font-family:'${child.family}';src:url('${src}') format('${fmt}');font-weight:${faceWeight};font-style:normal;font-display:swap;}`
        );
      });
    } else if (font.url) {
      const src = resolveFontUrl(font.url);
      const fmt = formatHint(font.format, font.url);
      rules.push(
        `@font-face{font-family:'${font.family}';src:url('${src}') format('${fmt}');font-weight:400;font-style:normal;font-display:swap;}`
      );
    }
  });

  document.getElementById(STYLE_ID)?.remove();
  if (rules.length) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = rules.join('\n');
    document.head.appendChild(style);
  }
  facesInjected = true;
}

function resetCatalogCache(): void {
  catalogCache = null;
  catalogAuthKey = null;
  loadPromise = null;
  facesInjected = false;
}

async function loadCatalogFromApi(bust = false): Promise<FontFamilyNode[]> {
  if (bust) {
    await queryClient.removeQueries({
      predicate: (q) => Array.isArray(q.queryKey) && isFontsQueryKey(q.queryKey),
    });
  }
  const page = (await queryClient.fetchQuery({
    ...fontsQueryOptions(),
    staleTime: bust ? 0 : 5 * 60_000,
  })) as { items?: unknown[] };
  return normalizeCatalog(page.items || []);
}

async function loadFontCatalogOnce(bust = false): Promise<FontFamilyNode[]> {
  try {
    const data = await loadCatalogFromApi(bust).catch(() => [] as FontFamilyNode[]);
    catalogCache = data;
    catalogAuthKey = currentCatalogAuthKey();
    if (data.length) injectFontFaces(data, { force: bust });
    return data;
  } catch {
    catalogCache = [];
    catalogAuthKey = currentCatalogAuthKey();
    return [];
  } finally {
    loadPromise = null;
  }
}

export async function loadFontCatalog(): Promise<FontFamilyNode[]> {
  const authKey = currentCatalogAuthKey();
  if (catalogCache && catalogAuthKey === authKey) return catalogCache;
  if (catalogCache && catalogAuthKey !== authKey) resetCatalogCache();
  if (loadPromise) return loadPromise;
  loadPromise = loadFontCatalogOnce();
  return loadPromise;
}

/** Drop cache and reload from API (after register/upload / auth change). */
export async function reloadFontCatalog(): Promise<FontFamilyNode[]> {
  resetCatalogCache();
  loadPromise = loadFontCatalogOnce(true);
  return loadPromise;
}

export function getFontCatalogSync(): FontFamilyNode[] {
  return catalogCache || [];
}

export function findFontFamily(family: string, catalog = getFontCatalogSync()): FontFamilyNode | undefined {
  const key = String(family || '');
  return (
    catalog.find((f) => f.family === key) ||
    catalog.find((f) => f.children?.some((c) => c.family === key))
  );
}

/** Map a stored face name back to the tree root family. */
export function getBaseFontFamily(fontFamily: string, catalog = getFontCatalogSync()): string {
  const key = String(fontFamily || '');
  for (const font of catalog) {
    if (font.family === key) return font.family;
    if (font.children?.some((c) => c.family === key)) return font.family;
  }
  if (/puhui|普惠/i.test(key) || key.startsWith('Alibaba PuHuiTi')) {
    return 'Alibaba PuHuiTi';
  }
  return key || 'Alibaba PuHuiTi';
}

export function getFontDisplayName(fontFamily: string, catalog = getFontCatalogSync()): string {
  const base = getBaseFontFamily(fontFamily, catalog);
  return catalog.find((f) => f.family === base)?.displayName || base;
}

/** Preview face for list rows (first child or base). */
export function getPreviewFontFamily(font: FontFamilyNode): string {
  if (font.children?.length) return font.children[0].family;
  return font.family;
}

export function getFontChildren(family: string, catalog = getFontCatalogSync()): FontChild[] {
  const base = getBaseFontFamily(family, catalog);
  const children = catalog.find((f) => f.family === base)?.children || [];
  // Weights without a real font file must not appear in the UI.
  return children.filter((c) => Boolean(c.url));
}

export function getDefaultFontChild(family: string, catalog = getFontCatalogSync()): FontChild | null {
  const children = getFontChildren(family, catalog);
  if (!children.length) {
    const node = findFontFamily(family, catalog);
    if (node?.url) {
      return { family: node.family, displayName: 'Regular', weight: 400, url: node.url };
    }
    return null;
  }
  return children.find((c) => /^regular$/i.test(c.displayName) || c.displayName === '常规') || children[0];
}

export function findFontChild(fontFamily: string, catalog = getFontCatalogSync()): FontChild | null {
  const key = String(fontFamily || '');
  for (const font of catalog) {
    const hit = font.children?.find((c) => c.family === key);
    if (hit) return hit;
    if (font.family === key && (!font.children || font.children.length === 0)) {
      return { family: font.family, displayName: 'Regular', weight: 400, url: font.url };
    }
  }
  return getDefaultFontChild(key, catalog);
}

function childSelectKey(child: FontChild, siblings: FontChild[]): string {
  const shared = siblings.filter((c) => c.family === child.family).length > 1;
  if (shared && child.weight != null) return `${child.family}::${child.weight}`;
  return child.family;
}

export function weightOptionsForFamily(
  fontFamily: string,
  catalog = getFontCatalogSync()
): FontWeightOption[] {
  const children = getFontChildren(fontFamily, catalog);
  // No fake Regular/Medium/Bold — only faces backed by a file URL.
  if (!children.length) return [];
  return children.map((c) => ({
    value: childSelectKey(c, children),
    label: c.displayName,
    weight: c.weight,
  }));
}

/** True when the family has a Bold (≈700) face with a file. */
export function familyHasBoldFace(fontFamily: string, catalog = getFontCatalogSync()): boolean {
  return getFontChildren(fontFamily, catalog).some((c) => (c.weight ?? 0) >= 600);
}

export function resolveWeightSelectValue(
  fontFamily: string,
  fontWeight: string | number | undefined,
  catalog = getFontCatalogSync()
): string {
  const children = getFontChildren(fontFamily, catalog);
  if (!children.length) return getBaseFontFamily(fontFamily, catalog);

  const numeric = numericFontWeight(fontWeight);

  const byFamily = children.filter((c) => c.family === fontFamily);
  if (byFamily.length > 1 && Number.isFinite(numeric)) {
    const match = byFamily.find((c) => c.weight === numeric);
    if (match) return childSelectKey(match, children);
  }

  const exact = children.find((c) => c.family === fontFamily);
  if (exact) return childSelectKey(exact, children);

  if (Number.isFinite(numeric)) {
    const byW = children.find((c) => c.weight === numeric);
    if (byW) return childSelectKey(byW, children);
  }

  const def = getDefaultFontChild(fontFamily, catalog);
  return def ? childSelectKey(def, children) : fontFamily;
}

export function applyFontFamilySelection(
  baseOrFace: string,
  catalog = getFontCatalogSync()
): { fontFamily: string; fontWeight: string } {
  const base = getBaseFontFamily(baseOrFace, catalog);
  const child = getDefaultFontChild(baseOrFace, catalog);
  if (!child) return { fontFamily: baseOrFace, fontWeight: 'normal' };
  return styleFromFontChild(child, catalog);
}

/**
 * Map a catalog face → canvas style. Dedicated faces (e.g. `Noto Sans SC Bold`)
 * keep `fontWeight: normal` so we never faux-bold with CSS on the Regular file.
 */
export function styleFromFontChild(
  child: FontChild,
  catalog = getFontCatalogSync()
): { fontFamily: string; fontWeight: string } {
  const base = getBaseFontFamily(child.family, catalog);
  const sameNameFaces = getFontChildren(base, catalog).filter((c) => c.family === child.family);
  // Multiple weights share one CSS family name — real @font-face weight axis.
  if (sameNameFaces.length > 1 && child.weight != null) {
    const w = child.weight;
    if (w >= 600) return { fontFamily: child.family, fontWeight: String(w) };
    if (w === 400) return { fontFamily: child.family, fontWeight: 'normal' };
    return { fontFamily: child.family, fontWeight: String(w) };
  }
  // One file per family name (… Light / Regular / Bold) — switch family, not CSS weight.
  return { fontFamily: child.family, fontWeight: 'normal' };
}

/** True when the current face is a Bold catalog file (… Bold) even with CSS weight normal. */
export function isCatalogBoldFace(fontFamily: string, catalog = getFontCatalogSync()): boolean {
  const key = String(fontFamily || '');
  if (/\bbold\b/i.test(key)) return true;
  const child = findFontChild(key, catalog);
  return Boolean(child && (child.weight ?? 0) >= 600);
}

/**
 * B button: switch to the real Bold/Regular face file when the catalog has one.
 * Avoids CSS faux-bold on Regular (paint ≠ outline).
 */
export function toggleCatalogTextBold(
  fontFamily: string,
  fontWeight: string | number | undefined,
  catalog = getFontCatalogSync()
): { fontFamily: string; fontWeight: string } {
  const children = getFontChildren(fontFamily, catalog);
  const weightBold = fontWeight === 'bold' || Number(fontWeight) >= 600;
  const onBold = weightBold || isCatalogBoldFace(fontFamily, catalog);

  if (onBold) {
    const regular =
      children.find((c) => (c.weight ?? 400) === 400) ||
      children.find((c) => (c.weight ?? 0) < 600) ||
      getDefaultFontChild(fontFamily, catalog);
    if (regular) return styleFromFontChild(regular, catalog);
    return { fontFamily: getBaseFontFamily(fontFamily, catalog), fontWeight: 'normal' };
  }

  const bold =
    children.find((c) => (c.weight ?? 0) >= 600) ||
    children.find((c) => /bold/i.test(c.displayName) || /bold/i.test(c.family));
  if (bold) return styleFromFontChild(bold, catalog);
  return { fontFamily, fontWeight: 'bold' };
}

export function parseWeightSelectValue(
  value: string,
  catalog = getFontCatalogSync()
): { family: string; weight: string } {
  const [familyPart, weightPart] = String(value).split('::');
  const family = familyPart || value;
  const base = getBaseFontFamily(family, catalog);
  const children = getFontChildren(base, catalog);
  const child =
    children.find((c) => {
      if (weightPart != null && weightPart !== '') {
        return c.family === family && String(c.weight) === weightPart;
      }
      return c.family === family;
    }) || findFontChild(family, catalog);

  if (child) {
    const next = styleFromFontChild(child, catalog);
    return { family: next.fontFamily, weight: next.fontWeight };
  }

  if (weightPart != null && weightPart !== '') {
    const w = Number(weightPart);
    // Prefer a dedicated Bold/Medium face over CSS faux-bold on the base family.
    if (Number.isFinite(w) && w >= 600) {
      const face =
        children.find((c) => c.weight === w) ||
        children.find((c) => (c.weight ?? 0) >= 600);
      if (face) {
        const next = styleFromFontChild(face, catalog);
        return { family: next.fontFamily, weight: next.fontWeight };
      }
    }
    if (w === 400) return { family: base, weight: 'normal' };
    if (Number.isFinite(w)) return { family: base, weight: String(w) };
  }

  return { family: family || base, weight: 'normal' };
}

export function fontDisplayName(font: Pick<FontFamilyNode, 'displayName' | 'family'>): string {
  return font.displayName || font.family;
}

function fontBelongsToUser(font: FontFamilyNode, userId: string): boolean {
  if (!userId) return false;
  if (font.isMine || font.ownerUserId === userId) return true;
  const needle = `uploads/${userId}/fonts/`;
  const urls = [font.url, ...font.children.map((c) => c.url)].filter(Boolean) as string[];
  return urls.some((url) => url.includes(needle));
}

/** Reconcile API `isMine` with owner id and upload path for legacy rows. */
export function markMineFonts(
  list: FontFamilyNode[],
  userId: string | null | undefined
): FontFamilyNode[] {
  const uid = String(userId || '').trim();
  if (!uid) return list;
  return list.map((font) => {
    const isMine = fontBelongsToUser(font, uid);
    let ownerUserId = font.ownerUserId ?? null;
    if (isMine && !ownerUserId) ownerUserId = uid;
    return { ...font, isMine, ownerUserId };
  });
}
