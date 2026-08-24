import { docsUrl, openExternalUrl } from '@/utils/docsUrl';

export const RAIL_HELP_WIKI =
  'https://my.feishu.cn/wiki/EuoxwPk4OighdZkmAVMc7Gisn8b?from=from_copylink';

export type RailHelpItemKey = 'guide' | 'contact' | 'updates';

export function railHelpItemKeys(desktopLocal: boolean): RailHelpItemKey[] {
  return desktopLocal ? ['guide', 'contact'] : ['guide', 'contact', 'updates'];
}

export function runRailHelpAction(key: string) {
  if (key === 'guide') {
    openExternalUrl(docsUrl('/guide/getting-started'));
    return;
  }
  if (key === 'contact') {
    openExternalUrl('mailto:702680355@qq.com');
    return;
  }
  openExternalUrl(RAIL_HELP_WIKI);
}
