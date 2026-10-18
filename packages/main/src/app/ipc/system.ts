import { app, ipcMain, shell } from 'electron';

import { createLogger } from '../../logging/index.js';
import type { EngineService } from '../../services/engine/engine-service.js';
import { engineStatus } from '../../services/engine-status.js';
import { updateMajsoulProtocol } from '../../services/protocol-updater.js';
import { resourceValidator } from '../../services/resource-validator.js';
import { EXIT_ANIMATION_DELAY_MS } from '../../shared/constants.js';
import { safeSend } from '../../shared/utils.js';
import type { WindowManager } from '../window-manager.js';

const logger = createLogger('IPC');

/** System-level requests: shutdown, bundled resources, protocol and external links. */
export function registerSystemHandlers(windowManager: WindowManager, engine: EngineService) {
  // Every window offers the same exit button, so a second click races the first.
  let shuttingDown = false;

  ipcMain.handle('request-shutdown', async () => {
    if (shuttingDown) return false;
    shuttingDown = true;

    // Let the windows play their exit animation while the engine shuts down.
    safeSend(windowManager.getMainWindow(), 'exit-animation-start');
    safeSend(windowManager.getGameWindow(), 'exit-animation-start');

    await Promise.all([
      new Promise((resolve) => setTimeout(resolve, EXIT_ANIMATION_DELAY_MS)),
      Promise.resolve(engine.stop()).catch((err: unknown) =>
        logger.error('Engine shutdown error:', err),
      ),
    ]);

    app.quit();
    return true;
  });

  ipcMain.handle('check-resource-status', async () => {
    return await resourceValidator.validate();
  });

  // A window that opens mid-session asks for the current status instead of
  // waiting for the next change.
  ipcMain.handle('engine:status:get', () => {
    return engineStatus.get();
  });

  ipcMain.handle('update-liqi', async () => {
    await updateMajsoulProtocol();
    return true;
  });

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
        return true;
      }
      logger.warn(`Blocked opening non-http URL: ${url}`);
      return false;
    } catch {
      logger.error(`Invalid URL for open-external: ${url}`);
      return false;
    }
  });
}
