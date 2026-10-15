import { Menu, nativeImage, Tray } from 'electron';

import { getAssetPath } from '../shared/paths.js';

export interface TrayHandlers {
  /** Tray click: show the dashboard when hidden, hide it when visible. */
  onToggleDashboard: () => void;
  onShowDashboard: () => void;
  onCheckForUpdates?: () => void;
  /** The user asked to quit; the dashboard confirms before the app exits. */
  onRequestQuit: () => void;
}

/** Creates the system tray icon with its menu. */
export function setupTray(handlers: TrayHandlers): Tray {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const iconFile = isWin ? 'torii.ico' : isMac ? 'toriiTemplate.png' : 'torii.png';
  const icon = nativeImage.createFromPath(getAssetPath('assets', iconFile));
  if (isMac) {
    icon.setTemplateImage(true);
  }

  const tray = new Tray(icon);

  tray.setToolTip('Akagi-NG');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Akagi-NG', enabled: false },
      { type: 'separator' },
      { label: 'Show Dashboard', click: handlers.onShowDashboard },
      { label: 'Check for Updates', click: () => handlers.onCheckForUpdates?.() },
      { type: 'separator' },
      { label: 'Quit Akagi-NG', click: handlers.onRequestQuit },
    ]),
  );

  tray.on('click', handlers.onToggleDashboard);

  return tray;
}
