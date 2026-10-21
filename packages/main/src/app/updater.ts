import { app, net } from 'electron';

import { createLogger } from '../logging/index.js';
import { GITHUB_RELEASES_API } from '../shared/constants.js';
import { safeSend } from '../shared/utils.js';
import type { WindowManager } from './window-manager.js';

const logger = createLogger('Updater');

interface GitHubRelease {
  tag_name: string;
}

function versionParts(version: string): number[] {
  const [head = ''] = version.replace(/^v/, '').split('-');
  return head.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Numeric comparison, so a release older than the running build is not offered
 * as an update. A pre-release suffix is ignored, which is the safe direction:
 * the app only ever ships plain `x.y.z` tags.
 */
function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }

  return false;
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

    if (isNewerVersion(latestVersion, currentVersion)) {
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
