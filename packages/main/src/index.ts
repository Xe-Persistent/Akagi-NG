import os from 'node:os';
import { join } from 'node:path';

import { app, dialog } from 'electron';

import { registerIpcHandlers } from './app/ipc/index.js';
import { UpdaterManager } from './app/updater.js';
import { WindowManager } from './app/window-manager.js';
import { createLogger, initializeLogger, setLogLevel } from './logging/index.js';
import { startMockStream, stopMockStream } from './mock-stream.js';
import { MitmProxyManager } from './services/capture/mitm-proxy.js';
import { EngineService } from './services/engine/engine-service.js';
import { getSettingsManager } from './services/settings-manager.js';
import { getProjectRoot } from './shared/paths.js';

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
}

// The stored level is applied once the app is ready; the settings store itself
// cannot be created before that (its default locale comes from `app.getLocale()`).
initializeLogger(join(getProjectRoot(), 'logs'));

const logger = createLogger('Main');

logger.info(`Starting Akagi-NG Desktop v${app.getVersion()}...`);
logger.info(`System: ${os.type()} ${os.release()} (${os.arch()})`);
logger.info(`Node.js: ${process.versions.node} | Electron: ${process.versions.electron}`);

const engineService = new EngineService();
const mitmProxyManager = new MitmProxyManager(engineService);
const windowManager = new WindowManager(engineService);
const updaterManager = new UpdaterManager(windowManager);

/** `npm run dev:mock` plays canned scenarios instead of capturing a game. */
const isMockRun = process.argv.includes('--mock');

engineService.setMockMode(isMockRun);

app.on('second-instance', () => {
  logger.info('Second instance detected. Focusing existing window...');
  const mainWindow = windowManager.getMainWindow();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else {
    void windowManager.createDashboardWindow();
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  dialog.showErrorBox('Main Process Crash', error.message || String(error));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

app.whenReady().then(async () => {
  // 0. Load the settings before anything else reads them
  setLogLevel(getSettingsManager().getSettings().log_level);
  registerIpcHandlers(windowManager, engineService, mitmProxyManager);

  // 1. Start MITM Proxy (a mock run captures nothing)
  if (!isMockRun) {
    await mitmProxyManager.start();
  }

  // 2. Setup Tray
  windowManager.setupTray(() => updaterManager.checkForUpdates());

  // 3. Create Dashboard Window
  void windowManager.createDashboardWindow();

  // 4. Feed the HUD from the canned scenarios
  if (isMockRun) {
    startMockStream();
  }

  // 5. Setup Auto Updater
  updaterManager.checkForUpdates();

  app.on('activate', () => {
    void windowManager.createDashboardWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let isQuitting = false;

app.on('before-quit', async (event) => {
  windowManager.setQuitting(true);
  if (isQuitting) return;

  event.preventDefault();
  isQuitting = true;

  try {
    stopMockStream();
    await mitmProxyManager.stop();
    engineService.stop();
  } catch (err) {
    logger.error('Error during shutdown:', err);
  } finally {
    app.quit();
  }
});
