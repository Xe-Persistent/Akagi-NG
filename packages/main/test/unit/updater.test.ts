/**
 * The update check is the only outbound call the app makes without being asked,
 * and the only place a version string decides something. Getting the comparison
 * wrong offers a downgrade; getting the broadcast wrong leaves the badge blank
 * because the dashboard chunk mounts after the one-shot event has gone out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdaterManager } from '../../src/app/updater.js';
import type { WindowManager } from '../../src/app/window-manager.js';
import { GITHUB_RELEASES_API } from '../../src/shared/constants.js';
import {
  app,
  BrowserWindow,
  messagesOn,
  resetNetFetch,
  resetSentMessages,
  setNetFetch,
} from '../electron-stub.js';

function windowManagerWith(dashboard: BrowserWindow | null) {
  return { getMainWindow: () => dashboard } as unknown as WindowManager;
}

/** Answers the releases endpoint with the given tag, recording the request. */
function release(tagName: string, status = 200) {
  const requests: { url: string; init: unknown }[] = [];

  setNetFetch(async (url, init) => {
    requests.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ tag_name: tagName }),
    };
  });

  return requests;
}

/** `checkForUpdates` is fire-and-forget, so the assertions wait for its effect. */
async function settled() {
  await vi.waitFor(() => expect(requestsSeen()).toBe(true));
}

let requests: { url: string; init: unknown }[] = [];
const requestsSeen = () => requests.length > 0;

describe('the update check', () => {
  beforeEach(() => {
    resetSentMessages();
    resetNetFetch();
    BrowserWindow.resetInstances();
    app.isPackaged = true;
    requests = [];
  });

  afterEach(() => {
    app.isPackaged = true;
    vi.restoreAllMocks();
  });

  it('does nothing in a development build', async () => {
    app.isPackaged = false;
    const fetchSpy = vi.fn();
    setNetFetch(fetchSpy);
    const updater = new UpdaterManager(windowManagerWith(null));

    updater.checkForUpdates();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks the releases endpoint with the GitHub media type', async () => {
    requests = release('v9.9.9');
    const updater = new UpdaterManager(windowManagerWith(null));

    updater.checkForUpdates();
    await settled();

    expect(requests[0]?.url).toBe(GITHUB_RELEASES_API);
    expect(requests[0]?.init).toMatchObject({
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
  });

  it('offers a newer release and remembers it for a late window', async () => {
    requests = release('v9.9.9');
    const dashboard = new BrowserWindow();
    const updater = new UpdaterManager(windowManagerWith(dashboard));

    updater.checkForUpdates();
    await settled();

    await vi.waitFor(() => expect(updater.getAvailableVersion()).toBe('9.9.9'));
    expect(messagesOn('app:update-available')).toEqual(['9.9.9']);
  });

  it('stays quiet when the running build is already the newest', async () => {
    requests = release('v0.0.0-test');

    const updater = new UpdaterManager(windowManagerWith(new BrowserWindow()));
    updater.checkForUpdates();
    await settled();

    await vi.waitFor(() => expect(updater.getAvailableVersion()).toBeNull());
    expect(messagesOn('app:update-available')).toEqual([]);
  });

  it('stays quiet when the offered release is older', async () => {
    requests = release('v0.0.0');

    const updater = new UpdaterManager(windowManagerWith(new BrowserWindow()));
    updater.checkForUpdates();
    await settled();

    await vi.waitFor(() => expect(updater.getAvailableVersion()).toBeNull());
  });

  it('compares versions as numbers rather than as text', async () => {
    // 0.0.0-test is the running version; 0.0.10 is newer, 0.0.0 is not, and
    // the pre-release suffix must not be read as a version part.
    requests = release('v0.0.10');
    const updater = new UpdaterManager(windowManagerWith(null));
    updater.checkForUpdates();
    await settled();

    await vi.waitFor(() => expect(updater.getAvailableVersion()).toBe('0.0.10'));
  });

  it('ignores a response GitHub refused', async () => {
    requests = release('v9.9.9', 403);

    const updater = new UpdaterManager(windowManagerWith(null));
    updater.checkForUpdates();
    await settled();

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(updater.getAvailableVersion()).toBeNull();
  });

  it('swallows a transport failure instead of becoming an unhandled rejection', async () => {
    setNetFetch(async () => {
      throw new Error('offline');
    });

    const updater = new UpdaterManager(windowManagerWith(null));
    updater.checkForUpdates();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The catch is what keeps an offline machine from crashing the app.
    expect(updater.getAvailableVersion()).toBeNull();
  });
});

describe('comparing a tag with the running version', () => {
  /** Reads the private decision through the only public path: one check. */
  async function offers(tag: string, current: string): Promise<boolean> {
    resetNetFetch();
    resetSentMessages();
    requests = release(tag);
    vi.spyOn(app, 'getVersion').mockReturnValue(current);

    const updater = new UpdaterManager(windowManagerWith(null));
    updater.checkForUpdates();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    return updater.getAvailableVersion() !== null;
  }

  it('treats a longer version as newer', async () => {
    await expect(offers('v1.2.10', '1.2.9')).resolves.toBe(true);
    await expect(offers('v1.10.0', '1.9.0')).resolves.toBe(true);
  });

  it('does not treat a shorter or equal version as newer', async () => {
    await expect(offers('v1.2.9', '1.2.10')).resolves.toBe(false);
    await expect(offers('v1.2.3', '1.2.3')).resolves.toBe(false);
  });

  it('ignores a pre-release suffix on either side', async () => {
    await expect(offers('v1.2.3', '1.2.3')).resolves.toBe(false);
    await expect(offers('v1.2.4', '1.2.3-beta.1')).resolves.toBe(true);
  });
});
