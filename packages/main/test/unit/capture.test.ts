/**
 * The capture layer's two pieces of bookkeeping: which websockets are open, and
 * what one captured frame does to the engine. Both are driven by a fake engine,
 * so no window, debugger or proxy is involved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bridgeManager } from '../../src/protocol/bridge-manager.js';
import { MajsoulBridge } from '../../src/protocol/majsoul/bridge.js';
import { ConnectionTracker } from '../../src/services/capture/connection-tracker.js';
import { ingestCapturedFrame } from '../../src/services/capture/frame-ingest.js';
import type { EngineService } from '../../src/services/engine/engine-service.js';
import { engineStatus } from '../../src/services/engine-status.js';
import { actionFrame, notifyFrame } from '../liqi-frames.js';
import { actions } from '../real-packets.js';

function fakeEngine() {
  return {
    clientConnected: vi.fn(),
    gameDisconnected: vi.fn(),
    ingest: vi.fn(async (_events: unknown[]) => {}),
  };
}

const asEngine = (fake: ReturnType<typeof fakeEngine>) => fake as unknown as EngineService;

/** Reports whether the game had already ended when the sockets closed. */
function bridgeThatEnded(gameEnded: boolean) {
  vi.spyOn(bridgeManager, 'getCurrentBridge').mockReturnValue({ gameEnded } as MajsoulBridge);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tracking the game websockets', () => {
  it('reports the first connection only', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));

    tracker.onConnectionOpened('a');
    tracker.onConnectionOpened('a');
    tracker.onConnectionOpened('b');

    expect(engine.clientConnected).toHaveBeenCalledTimes(1);
  });

  it('reports the last close only, with what the game said about ending', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));
    bridgeThatEnded(true);

    tracker.onConnectionOpened('a');
    tracker.onConnectionOpened('b');
    tracker.onConnectionClosed('a');
    expect(engine.gameDisconnected).not.toHaveBeenCalled();

    tracker.onConnectionClosed('b');
    expect(engine.gameDisconnected).toHaveBeenCalledWith(true);
  });

  it('ignores a close for a socket it never opened', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));

    tracker.onConnectionClosed('never-seen');

    expect(engine.gameDisconnected).not.toHaveBeenCalled();
  });

  it('ignores a repeated close', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));
    bridgeThatEnded(false);

    tracker.onConnectionOpened('a');
    tracker.onConnectionClosed('a');
    tracker.onConnectionClosed('a');

    expect(engine.gameDisconnected).toHaveBeenCalledTimes(1);
  });

  it('disconnects when the capture is torn down without close events', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));
    bridgeThatEnded(false);

    tracker.onConnectionOpened('a');
    tracker.forceDisconnect();

    expect(engine.gameDisconnected).toHaveBeenCalledWith(false);

    // Everything is already closed, so the late close event changes nothing.
    tracker.onConnectionClosed('a');
    expect(engine.gameDisconnected).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there was nothing to tear down', () => {
    const engine = fakeEngine();
    const tracker = new ConnectionTracker(asEngine(engine));

    tracker.forceDisconnect();

    expect(engine.gameDisconnected).not.toHaveBeenCalled();
  });
});

describe('a captured frame', () => {
  const newRound = actions.find((packet) => packet.name === 'ActionNewRound')!;

  it('feeds the events it produced to the engine', async () => {
    const engine = fakeEngine();

    await ingestCapturedFrame(
      asEngine(engine),
      new MajsoulBridge(),
      actionFrame(newRound.name, newRound.fields),
      'MITM',
    );

    expect(engine.ingest).toHaveBeenCalledTimes(1);
    expect(engine.ingest.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ type: 'start_kyoku' }),
    ]);
  });

  it('leaves the engine alone for a frame that carries no events', async () => {
    const engine = fakeEngine();

    await ingestCapturedFrame(
      asEngine(engine),
      new MajsoulBridge(),
      notifyFrame('.lq.Route.heartbeat', Buffer.alloc(0)),
      'CDP',
    );

    expect(engine.ingest).not.toHaveBeenCalled();
  });

  it('reports a frame it could not decode', async () => {
    const engine = fakeEngine();

    await ingestCapturedFrame(
      asEngine(engine),
      new MajsoulBridge(),
      notifyFrame('.lq.ActionMJStart', Buffer.from([0xff, 0xff, 0xff, 0xff])),
      'CDP',
    );

    expect(engineStatus.get().notice?.kind).toBe('parse_failed');
    expect(engine.ingest).not.toHaveBeenCalled();
  });

  it('reports a replay so the HUD can say why it is silent', async () => {
    const engine = fakeEngine();
    const replaying = {
      parse: () => ({ events: [], replayed: true }),
    } as unknown as MajsoulBridge;

    await ingestCapturedFrame(asEngine(engine), replaying, Buffer.alloc(0), 'CDP');

    expect(engineStatus.get().notice?.kind).toBe('syncing');
  });

  it('swallows a frame that throws instead of tearing down the capture', async () => {
    const engine = fakeEngine();
    const broken = {
      parse: () => {
        throw new Error('boom');
      },
    } as unknown as MajsoulBridge;

    await expect(
      ingestCapturedFrame(asEngine(engine), broken, Buffer.alloc(0), 'CDP'),
    ).resolves.toBeUndefined();
    expect(engine.ingest).not.toHaveBeenCalled();
  });
});
