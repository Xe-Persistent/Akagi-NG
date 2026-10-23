import os from 'node:os';
import { join } from 'node:path';

import { app, dialog, type Event } from 'electron';

import { registerIpcHandlers } from './app/ipc/index.js';
import { UpdaterManager } from './app/updater.js';
import { WindowManager } from './app/window-manager.js';
import { createLogger, initializeLogger, setLogLevel } from './logging/index.js';
import { MitmProxyManager } from './services/capture/mitm-proxy.js';
import { EngineService } from './services/engine/engine-service.js';
import { startMockStream, stopMockStream } from './services/mock/stream.js';
import { getSettingsManager } from './services/settings-manager.js';
import { getProjectRoot } from './shared/paths.js';
import { anonymizeUserAgent } from './shared/user-agent.js';

// A second launch must not add a second tray icon or a second capture session.
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

// Electron advertises itself and the app in the default agent; clean it once
// so every window — including OAuth popups — matches plain Chrome.
app.userAgentFallback = anonymizeUserAgent(app.userAgentFallback);

const engineService = new EngineService();
const mitmProxyManager = new MitmProxyManager(engineService);
const windowManager = new WindowManager(engineService);
const updaterManager = new UpdaterManager(windowManager);

/** `npm run dev:mock` plays canned scenarios instead of capturing a game. */
const isMockRun = process.argv.includes('--mock');

engineService.setMockMode(isMockRun);

app.on('second-instance', () => {
  logger.info('Second instance detected. Focusing the existing window.');
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

void app.whenReady().then(async () => {
  // The settings own the log level and the proxy config, so they load first.
  setLogLevel(getSettingsManager().getSettings().log_level);
  registerIpcHandlers(windowManager, engineService, mitmProxyManager);

  // A mock run reads canned scenarios and captures nothing.
  if (!isMockRun) {
    await mitmProxyManager.start();
  }

  windowManager.setupTray(() => updaterManager.checkForUpdates());
  void windowManager.createDashboardWindow();

  if (isMockRun) {
    startMockStream();
  }

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

async function quitGracefully(event: Event) {
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
}

app.on('before-quit', (event) => {
  void quitGracefully(event);
});
