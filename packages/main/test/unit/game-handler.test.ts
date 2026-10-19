import { EventEmitter } from 'node:events';

import type { WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameHandler } from '../../src/services/capture/game-handler.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';

/** Stands in for `webContents.debugger`, including the `detach` event. */
class FakeDebugger extends EventEmitter {
  public attachCalls = 0;
  public attached = false;
  public sendCommand = vi.fn(async () => ({}));

  attach() {
    this.attachCalls += 1;
    this.attached = true;
  }

  detach() {
    this.attached = false;
    this.emit('detach', {}, 'target closed');
  }

  isAttached() {
    return this.attached;
  }
}

/**
 * Only the surface `GameHandler` touches: event subscription, a liveness check
 * and the debugger API.
 */
function makeContents() {
  const events = new EventEmitter();
  const debuggerApi = new FakeDebugger();
  const contents = {
    debugger: debuggerApi,
    isDestroyed: () => false,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  } as unknown as WebContents;

  return { contents, events, debuggerApi };
}

const engine = {} as unknown as EngineService;

describe('the CDP capture handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables network inspection so frames are reported at all', async () => {
    const { contents, debuggerApi } = makeContents();

    await new GameHandler(contents, engine).attach();

    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Network.enable');
  });

  it('re-attaches after a reload drops the debugger session', async () => {
    const { contents, events, debuggerApi } = makeContents();
    const handler = new GameHandler(contents, engine);

    await handler.attach();
    expect(debuggerApi.attachCalls).toBe(1);

    debuggerApi.detach();
    events.emit('did-finish-load');
    await vi.advanceTimersByTimeAsync(600);

    expect(debuggerApi.attachCalls).toBe(2);
  });

  // Switching to MITM detaches the handler; a later reload must not silently
  // resume CDP capture next to the proxy, which would ingest every frame twice.
  it('never re-attaches once detached, even when the page reloads', async () => {
    const { contents, events, debuggerApi } = makeContents();
    const handler = new GameHandler(contents, engine);

    await handler.attach();
    handler.detach();

    events.emit('did-finish-load');
    await vi.advanceTimersByTimeAsync(600);

    expect(debuggerApi.attachCalls).toBe(1);
  });

  it('stays detached after disposal is followed by another attach call', async () => {
    const { contents, debuggerApi } = makeContents();
    const handler = new GameHandler(contents, engine);

    await handler.attach();
    handler.detach();
    await handler.attach();

    expect(debuggerApi.attachCalls).toBe(1);
  });
});
