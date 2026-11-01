/**
 * The tray is the only surface that exists while the dashboard is hidden, so its
 * menu is the app's real quit path and its click is the only way back. Which
 * icon it loads is platform-specific, and a wrong name there means an invisible
 * tray icon rather than an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupTray } from '../../src/app/tray.js';
import { type FakeMenuItem, Menu, Tray } from '../electron-stub.js';

const originalPlatform = process.platform;

/** Makes `process.platform` read as `platform` for the duration of one test. */
function pretendPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function handlers() {
  return {
    onToggleDashboard: vi.fn(),
    onShowDashboard: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onRequestQuit: vi.fn(),
  };
}

const template = (): FakeMenuItem[] => Menu.built.at(-1) ?? [];

describe('the tray icon', () => {
  beforeEach(() => {
    Tray.resetInstances();
    Menu.reset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('uses the .ico on Windows', () => {
    pretendPlatform('win32');

    setupTray(handlers());

    const icon = Tray.instances[0]?.icon as { path: string; template: boolean };
    expect(icon.path).toMatch(/assets[\\/]torii\.ico$/);
    expect(icon.template).toBe(false);
  });

  it('uses the template png on macOS and marks it as a template', () => {
    pretendPlatform('darwin');

    setupTray(handlers());

    const icon = Tray.instances[0]?.icon as { path: string; template: boolean };
    expect(icon.path).toMatch(/assets[\\/]toriiTemplate\.png$/);
    // Without the template flag macOS renders the icon in colour and it
    // disappears against a dark menu bar.
    expect(icon.template).toBe(true);
  });

  it('uses the plain png everywhere else', () => {
    pretendPlatform('linux');

    setupTray(handlers());

    const icon = Tray.instances[0]?.icon as { path: string; template: boolean };
    expect(icon.path).toMatch(/assets[\\/]torii\.png$/);
    expect(icon.template).toBe(false);
  });

  it('gives the tray a tooltip and a menu', () => {
    pretendPlatform('win32');

    setupTray(handlers());

    const tray = Tray.instances[0];
    expect(tray?.toolTip).toBe('Akagi-NG');
    expect(tray?.menu).toEqual({ template: template() });
  });

  it('toggles the dashboard when the icon itself is clicked', () => {
    const callbacks = handlers();
    const tray = setupTray(callbacks);

    tray.emit('click');

    expect(callbacks.onToggleDashboard).toHaveBeenCalledTimes(1);
    expect(callbacks.onShowDashboard).not.toHaveBeenCalled();
  });

  it('wires every menu item to its handler', () => {
    const callbacks = handlers();
    setupTray(callbacks);

    const items = template();
    expect(items.map((item) => item.label ?? `(${item.type})`)).toEqual([
      'Akagi-NG',
      '(separator)',
      'Show Dashboard',
      'Check for Updates',
      '(separator)',
      'Quit Akagi-NG',
    ]);
    expect(items[0]?.enabled).toBe(false);

    items[2]?.click?.();
    items[3]?.click?.();
    items[5]?.click?.();

    expect(callbacks.onShowDashboard).toHaveBeenCalledTimes(1);
    expect(callbacks.onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(callbacks.onRequestQuit).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleDashboard).not.toHaveBeenCalled();
  });
});
