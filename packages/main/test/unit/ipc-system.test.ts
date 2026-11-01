/**
 * The system channels. Two of them are security decisions rather than plumbing:
 * `open-external` is the only way renderer-supplied text can reach the OS, so it
 * must refuse anything that is not http(s); and `request-shutdown` must go
 * through the same quit path as every other way of closing the app, never exit
 * on its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/protocol-updater.js', () => ({
  updateMajsoulProtocol: vi.fn(async () => {}),
}));

import { registerSystemHandlers } from '../../src/app/ipc/system.js';
import type { UpdaterManager } from '../../src/app/updater.js';
import { engineStatus } from '../../src/services/engine-status.js';
import { updateMajsoulProtocol } from '../../src/services/protocol-updater.js';
import {
  app,
  invokeIpc,
  openedExternal,
  resetIpcListeners,
  resetOpenedExternal,
  resetSentMessages,
} from '../electron-stub.js';

function updater(version: string | null = null) {
  return { getAvailableVersion: vi.fn(() => version) } as unknown as UpdaterManager & {
    getAvailableVersion: ReturnType<typeof vi.fn>;
  };
}

describe('the system IPC surface', () => {
  let uptime: ReturnType<typeof updater>;

  beforeEach(() => {
    resetIpcListeners();
    resetSentMessages();
    resetOpenedExternal();
    vi.clearAllMocks();
    engineStatus.reset();
    vi.spyOn(app, 'quit').mockImplementation(() => {});

    uptime = updater();
    registerSystemHandlers(uptime);
  });

  it('quits through the shared path instead of exiting by itself', async () => {
    await expect(invokeIpc('request-shutdown')).resolves.toBe(true);

    // `app.quit()` fires `before-quit`, which is what runs the exit sequence.
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('hands out the update a check already found', async () => {
    uptime = updater('1.3.0');
    resetIpcListeners();
    registerSystemHandlers(uptime);

    await expect(invokeIpc('app:update:get')).resolves.toBe('1.3.0');
  });

  it('answers a window that asks for the status mid-session', async () => {
    engineStatus.set({ connection: 'connected', model: 'ready' });

    await expect(invokeIpc('engine:status:get')).resolves.toMatchObject({
      connection: 'connected',
      model: 'ready',
    });
  });

  it('reports the bundled models as present in this checkout', async () => {
    await expect(invokeIpc('check-resource-status')).resolves.toEqual({ models: true });
  });

  it('refreshes the protocol through the same pipeline the script uses', async () => {
    await expect(invokeIpc('update-liqi')).resolves.toBe(true);

    expect(updateMajsoulProtocol).toHaveBeenCalledTimes(1);
  });

  describe('opening a link', () => {
    it('opens an http or https address', async () => {
      await expect(
        invokeIpc('open-external', { id: 1 }, 'https://example.test/a?b=1'),
      ).resolves.toBe(true);
      await expect(invokeIpc('open-external', { id: 1 }, 'http://example.test')).resolves.toBe(
        true,
      );

      expect(openedExternal).toEqual(['https://example.test/a?b=1', 'http://example.test']);
    });

    it('refuses every other scheme', async () => {
      for (const url of [
        'file:///etc/passwd',
        'javascript:alert(1)',
        'ms-settings:',
        'mailto:a@b',
      ]) {
        await expect(invokeIpc('open-external', { id: 1 }, url)).resolves.toBe(false);
      }

      expect(openedExternal).toEqual([]);
    });

    it('refuses text that is not a URL at all', async () => {
      await expect(invokeIpc('open-external', { id: 1 }, 'not a url')).resolves.toBe(false);

      expect(openedExternal).toEqual([]);
    });
  });
});
