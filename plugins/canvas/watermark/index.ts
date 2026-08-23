/**
 * Sample canvas plugin — inserts a translucent text watermark at viewport center.
 */
import type { CanvasPluginModule } from '@/plugins/canvas/host';
import manifestJson from './manifest.json';
import iconUrl from './icon.svg';

const manifest = manifestJson as CanvasPluginModule['manifest'];

function tipForLocale(): string {
  const lang =
    typeof navigator !== 'undefined' ? String(navigator.language || '').toLowerCase() : 'en';
  const locales = (manifestJson as { locales?: Record<string, { tip?: string }> }).locales || {};
  if (lang.startsWith('zh')) return locales['zh-CN']?.tip || '插入半透明水印文字';
  return locales.en?.tip || 'Insert a translucent watermark';
}

const watermarkPlugin: CanvasPluginModule = {
  manifest,
  register(api) {
    api.registerToolbarButton({
      id: 'canvas-watermark.insert',
      tip: tipForLocale(),
      order: 220,
      iconSrc: iconUrl,
      onClick(runtime) {
        const state = runtime.getState();
        if (!state.editor?.document) return;
        runtime.placeText({
          text: '© Watermark',
          fontSize: 36,
          opacity: 0.35,
        });
      },
    });
  },
};

export default watermarkPlugin;
