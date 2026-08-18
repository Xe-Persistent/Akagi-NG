import { app, net } from 'electron';

import { GITHUB_RELEASES_API } from './constants.js';
import { createLogger } from './logger.js';
import { safeSend } from './utils.js';
import type { WindowManager } from './window-manager.js';

const logger = createLogger('Updater');

interface GitHubRelease {
  tag_name: string;
}

export class UpdaterManager {
  constructor(private windowManager: WindowManager) {}

  public checkForUpdates() {
    if (!app.isPackaged) {
      logger.info('Running in dev mode, skipping update check.');
      return;
    }

    this.fetchLatestVersion().catch((err) => {
      logger.error('Error checking for updates:', err);
    });
  }

  private async fetchLatestVersion(): Promise<void> {
    const response = await net.fetch(GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      logger.warn(`GitHub API returned ${response.status}`);
      return;
    }

    const data = (await response.json()) as GitHubRelease;
    const latestVersion = data.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (latestVersion !== currentVersion) {
      logger.info(`Update available: v${currentVersion} → v${latestVersion}`);
      this.notifyWindow('app:update-available', latestVersion);
    } else {
      logger.info(`Already on latest version: v${currentVersion}`);
    }
  }

  private notifyWindow(channel: string, data?: unknown) {
    const mainWin = this.windowManager.getMainWindow();
    safeSend(mainWin, channel, data);
  }
}
