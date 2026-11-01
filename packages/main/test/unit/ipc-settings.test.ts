/**
 * Settings are not just a file: a change has to reach whatever is already
 * running — the log level, the proxy, the answering model, the open windows.
 * The rule that matters is that an edit touches only what it names, so editing
 * an unrelated field must never interrupt a capture in progress.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import log from 'electron-log/main';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSettingsHandlers } from '../../src/app/ipc/settings.js';
import type { WindowManager } from '../../src/app/window-manager.js';
import type { MitmProxyManager } from '../../src/services/capture/mitm-proxy.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import { getSettingsManager } from '../../src/services/settings-manager.js';
import {
  BrowserWindow,
  invokeIpc,
  messagesOn,
  resetIpcListeners,
  resetSentMessages,
} from '../electron-stub.js';
import { useTempProjectRootForFile } from '../project-root.js';

interface Services {
  mitm: MitmProxyManager & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  windowManager: WindowManager & { syncGameWindowProxy: ReturnType<typeof vi.fn> };
  engine: EngineService & { refreshInferenceSource: ReturnType<typeof vi.fn> };
}

function services(): Services {
  return {
    mitm: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as Services['mitm'],
    windowManager: {
      syncGameWindowProxy: vi.fn().mockResolvedValue(undefined),
    } as unknown as Services['windowManager'],
    engine: { refreshInferenceSource: vi.fn() } as unknown as Services['engine'],
  };
}

describe('the settings IPC surface', () => {
  const projectRoot = useTempProjectRootForFile('akagi-ipc-settings');

  let deps: Services;
  let update: (updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;

  beforeEach(() => {
    resetIpcListeners();
    resetSentMessages();
    BrowserWindow.resetInstances();
    getSettingsManager().resetSettings();

    deps = services();
    registerSettingsHandlers(deps.mitm, deps.windowManager, deps.engine);

    update = (updates) => invokeIpc('settings:update', { id: 1 }, updates);
  });

  it('hands the renderer a snapshot of the current settings', async () => {
    const settings = await invokeIpc<Record<string, unknown>>('settings:get');

    expect(settings).toMatchObject({
      log_level: 'info',
      // The stub reports a zh-CN system locale, which is what the default comes from.
      locale: 'zh-CN',
      mitm: { enabled: false, port: 6789, upstream: '' },
      ot: { online: false },
    });
    // A copy, not the store's own object: a renderer cannot write through it.
    expect(settings).not.toBe(getSettingsManager().getSettings());
  });

  it('saves a change and leaves the running services alone when nothing they use moved', async () => {
    const result = await update({ model_config: { model_4p: 'other.safetensors' } });

    expect(result).toEqual({ success: true });
    expect(getSettingsManager().getSettings().model_config.model_4p).toBe('other.safetensors');
    expect(deps.mitm.stop).not.toHaveBeenCalled();
    expect(deps.mitm.start).not.toHaveBeenCalled();
    expect(deps.windowManager.syncGameWindowProxy).not.toHaveBeenCalled();
    expect(deps.engine.refreshInferenceSource).not.toHaveBeenCalled();
  });

  it('applies a new log level', async () => {
    await update({ log_level: 'debug' });

    expect(log.transports.file.level).toBe('debug');
  });

  it('restarts the proxy and re-points the window when its configuration moves', async () => {
    await update({ mitm: { enabled: true, port: 7890 } });

    expect(deps.mitm.stop).toHaveBeenCalledTimes(1);
    expect(deps.mitm.start).toHaveBeenCalledTimes(1);
    expect(deps.windowManager.syncGameWindowProxy).toHaveBeenCalledWith(true);
  });

  it('only stops the proxy when it is being switched off', async () => {
    getSettingsManager().updateSettings({ mitm: { enabled: true } as never });

    await update({ mitm: { enabled: false } });

    expect(deps.mitm.stop).toHaveBeenCalledTimes(1);
    expect(deps.mitm.start).not.toHaveBeenCalled();
    expect(deps.windowManager.syncGameWindowProxy).toHaveBeenCalledWith(false);
  });

  it('re-points the window when only the port changed', async () => {
    getSettingsManager().updateSettings({ mitm: { enabled: true } as never });

    await update({ mitm: { port: 7891 } });

    // The open window still points at the old port.
    expect(deps.mitm.stop).toHaveBeenCalledTimes(1);
    expect(deps.windowManager.syncGameWindowProxy).toHaveBeenCalledWith(true);
  });

  it('announces the new answering model when the online switch flips', async () => {
    await update({ ot: { online: true } });

    expect(deps.engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
  });

  it('tells every open window about a locale change', async () => {
    const dashboard = new BrowserWindow();
    const hud = new BrowserWindow();

    await update({ locale: 'ja-JP' });

    expect(messagesOn('locale-changed')).toEqual(['ja-JP', 'ja-JP']);
    expect(dashboard.webContents.isDestroyed()).toBe(false);
    expect(hud.webContents.isDestroyed()).toBe(false);
  });

  it('reports a rejected value instead of throwing at the renderer', async () => {
    const result = await update({ locale: 'klingon' });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // The stored settings are untouched by a rejected write.
    expect(getSettingsManager().getSettings().locale).toBe('zh-CN');
  });

  it('applies the defaults a reset restored', async () => {
    getSettingsManager().updateSettings({ log_level: 'debug', ot: { online: true } as never });

    const settings = await invokeIpc<Record<string, unknown>>('settings:reset');

    expect(settings).toMatchObject({ log_level: 'info', ot: { online: false } });
    expect(log.transports.file.level).toBe('info');
    expect(deps.engine.refreshInferenceSource).toHaveBeenCalledTimes(1);
  });

  it('lists only the models this build can load', async () => {
    mkdirSync(join(projectRoot(), 'models'), { recursive: true });
    writeFileSync(join(projectRoot(), 'models', 'akagi4p.safetensors'), '');
    writeFileSync(join(projectRoot(), 'models', 'notes.txt'), '');

    await expect(invokeIpc('settings:get-models')).resolves.toEqual(['akagi4p.safetensors']);
  });
});
