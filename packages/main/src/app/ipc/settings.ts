import { BrowserWindow, ipcMain } from 'electron';

import { createLogger, setLogLevel } from '../../logging/index.js';
import type { MitmProxyManager } from '../../services/capture/mitm-proxy.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import type { AppSettings } from '../../services/settings-manager.js';
import { getSettingsManager } from '../../services/settings-manager.js';
import { errorMessage } from '../../shared/errors.js';
import { safeSend } from '../../shared/utils.js';
import type { WindowManager } from '../window-manager.js';

const logger = createLogger('IPC');

/**
 * Applies what a settings change implies at runtime. Only the parts that
 * actually changed are touched, so editing an unrelated field never interrupts
 * a running capture.
 */
async function applyRuntimeSettings(
  mitmProxyManager: MitmProxyManager,
  windowManager: WindowManager,
  engine: EngineService,
  before: AppSettings,
  after: AppSettings,
): Promise<void> {
  if (before.log_level !== after.log_level) {
    setLogLevel(after.log_level);
  }

  if (!isSameMitmConfig(before, after)) {
    await mitmProxyManager.stop();
    if (after.mitm.enabled) {
      await mitmProxyManager.start();
    }
    // The open window still points at the old port, or at a proxy that just
    // stopped, so it has to be re-pointed.
    await windowManager.syncGameWindowProxy(after.mitm.enabled);
  }

  // The switch decides which model answers, so the status has to say so
  // immediately rather than at the next game.
  if (before.ot.online !== after.ot.online) {
    engine.refreshInferenceSource();
  }

  if (before.locale !== after.locale) {
    for (const win of BrowserWindow.getAllWindows()) {
      safeSend(win, 'locale-changed', after.locale);
    }
  }
}

function isSameMitmConfig(before: AppSettings, after: AppSettings): boolean {
  const a = before.mitm;
  const b = after.mitm;
  return a.enabled === b.enabled && a.port === b.port && a.upstream === b.upstream;
}

/** Settings reads/writes, plus applying what a change implies. */
export function registerSettingsHandlers(
  mitmProxyManager: MitmProxyManager,
  windowManager: WindowManager,
  engine: EngineService,
) {
  const settingsManager = getSettingsManager();

  ipcMain.handle('settings:get', () => {
    return settingsManager.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    try {
      const before = settingsManager.getSettings();
      settingsManager.updateSettings(updates);
      await applyRuntimeSettings(
        mitmProxyManager,
        windowManager,
        engine,
        before,
        settingsManager.getSettings(),
      );
      return { success: true };
    } catch (err: unknown) {
      logger.error('Failed to update settings:', err);
      return { success: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle('settings:reset', async () => {
    const before = settingsManager.getSettings();
    const after = settingsManager.resetSettings();
    await applyRuntimeSettings(mitmProxyManager, windowManager, engine, before, after);
    return after;
  });

  ipcMain.handle('settings:get-models', () => settingsManager.getAvailableModels());
}
