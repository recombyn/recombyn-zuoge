import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetCanvasPluginsForTests,
  installCanvasPlugin,
  listCanvasToolbarButtons,
  type CanvasPluginModule,
} from '@/plugins/canvas/host';

describe('canvas plugin host', () => {
  beforeEach(() => {
    __resetCanvasPluginsForTests();
  });

  it('registers toolbar buttons from a pack', () => {
    const pack: CanvasPluginModule = {
      manifest: { id: 'demo', name: 'Demo', enabled: true },
      register(api) {
        api.registerToolbarButton({
          id: 'demo.btn',
          tip: 'Demo tip',
          order: 10,
          onClick() {},
        });
      },
    };
    installCanvasPlugin(pack);
    const buttons = listCanvasToolbarButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.id).toBe('demo.btn');
    expect(buttons[0]?.pluginId).toBe('demo');
    expect(buttons[0]?.tip).toBe('Demo tip');
  });

  it('skips disabled packs and duplicate installs', () => {
    const pack: CanvasPluginModule = {
      manifest: { id: 'off', name: 'Off', enabled: false },
      register(api) {
        api.registerToolbarButton({ id: 'off.btn', tip: 'x', onClick() {} });
      },
    };
    installCanvasPlugin(pack);
    expect(listCanvasToolbarButtons()).toHaveLength(0);

    const on: CanvasPluginModule = {
      manifest: { id: 'once', name: 'Once' },
      register(api) {
        api.registerToolbarButton({ id: 'once.btn', tip: 'y', onClick() {} });
      },
    };
    installCanvasPlugin(on);
    installCanvasPlugin(on);
    expect(listCanvasToolbarButtons()).toHaveLength(1);
  });
});
