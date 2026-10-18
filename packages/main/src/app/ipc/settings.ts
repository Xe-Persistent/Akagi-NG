import { BrowserWindow, ipcMain } from 'electron';

import { createLogger, setLogLevel } from '../../logging/index.js';
import type { MitmProxyManager } from '../../services/capture/mitm-proxy.js';
import type { AppSettings } from '../../services/settings-manager.js';
import { getSettingsManager } from '../../services/settings-manager.js';
import { safeSend } from '../../shared/utils.js';

const logger = createLogger('IPC');

/**
 * Applies what a settings change implies at runtime. Only the parts that
 * actually changed are touched, so editing an unrelated field never interrupts
 * a running capture.
 */
async function applyRuntimeSettings(
  mitmProxyManager: MitmProxyManager,
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
  return (
    a.enabled === b.enabled && a.host === b.host && a.port === b.port && a.upstream === b.upstream
  );
}

/** Settings reads/writes, plus applying what a change implies. */
export function registerSettingsHandlers(mitmProxyManager: MitmProxyManager) {
  const settingsManager = getSettingsManager();

  ipcMain.handle('settings:get', () => {
    return settingsManager.getSettings();
  });

  ipcMain.handle('settings:update', async (_event, updates: Partial<AppSettings>) => {
    try {
      const before = settingsManager.getSettings();
      settingsManager.updateSettings(updates);
      await applyRuntimeSettings(mitmProxyManager, before, settingsManager.getSettings());
      return { success: true };
    } catch (err: unknown) {
      logger.error('Failed to update settings:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('settings:reset', async () => {
    const before = settingsManager.getSettings();
    const after = settingsManager.resetSettings();
    await applyRuntimeSettings(mitmProxyManager, before, after);
    return after;
  });

  ipcMain.handle('settings:get-models', async () => {
    return await settingsManager.getAvailableModels();
  });
}
