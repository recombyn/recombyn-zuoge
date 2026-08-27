import type { TFunction } from 'i18next';
import type { UserAsset } from '@/models/assets';

export type AssetDayGroup = {
  dayKey: string;
  label: string;
  items: UserAsset[];
};

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isSameCalendarDay(aMs: number, bMs: number): boolean {
  return startOfLocalDay(aMs) === startOfLocalDay(bMs);
}

export function assetDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatAssetDayLabel(ms: number, locale: string, t: TFunction): string {
  const date = new Date(ms);
  const now = new Date();
  if (isSameCalendarDay(ms, now.getTime())) {
    return t('editor.assets.dateToday', { defaultValue: '今天' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameCalendarDay(ms, yesterday.getTime())) {
    return t('editor.assets.dateYesterday', { defaultValue: '昨天' });
  }
  if (locale.startsWith('zh')) {
    const y = date.getFullYear();
    const nowY = now.getFullYear();
    if (y === nowY) return `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${y}年${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return date.toLocaleDateString(locale, {
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  });
}

/** Preserve API list order; merge items that share the same calendar day. */
export function groupUserAssetsByDay(
  assets: UserAsset[],
  locale: string,
  t: TFunction
): AssetDayGroup[] {
  const map = new Map<string, UserAsset[]>();
  const order: string[] = [];
  for (const asset of assets) {
    const raw = Number(asset.createdAt);
    const ms = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const key = ms > 0 ? assetDayKey(ms) : '__unknown__';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(asset);
  }
  return order.map((dayKey) => {
    const items = map.get(dayKey)!;
    const sampleMs = Number(items[0]?.createdAt) || 0;
    const label =
      dayKey === '__unknown__'
        ? t('editor.assets.dateUnknown', { defaultValue: '未知日期' })
        : formatAssetDayLabel(sampleMs, locale, t);
    return { dayKey, label, items };
  });
}
