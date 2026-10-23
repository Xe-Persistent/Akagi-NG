/**
 * How the proxy reports the end of a game socket.
 *
 * mockttp fires `websocket-close` only for a clean shutdown and reports an
 * unclean one (close code 1006 — the game window killed, the page reloaded, the
 * network dropped) as `abort`. Both have to reach the tracker, or a player who
 * closes the window is never told the connection went away.
 *
 * The host has to look like a Majsoul gateway for the tracker to accept it, so
 * `dns.lookup` is pointed at the local upstream for the duration.
 */
import dns from 'node:dns';
import { createServer, request, type Server } from 'node:http';

import { HttpProxyAgent } from 'http-proxy-agent';
import * as mockttp from 'mockttp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { trackGameSockets } from '../../src/services/capture/mitm-proxy.js';

const GAME_HOST = 'game.maj-soul.com';

const opened: string[] = [];
const closed: string[] = [];

const tracker = {
  onConnectionOpened: (id: string) => opened.push(id),
  onConnectionClosed: (id: string) => closed.push(id),
};

let upstream: Server;
let wss: WebSocketServer;
let proxy: mockttp.Mockttp;
let upstreamPort = 0;
const originalLookup = dns.lookup;

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: unknown,
  family?: number,
) => void;

/** Resolves the game host locally; everything else keeps the real resolver. */
function useLocalGameHost() {
  dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
    const done = (typeof options === 'function' ? options : callback) as LookupCallback;
    if (hostname === GAME_HOST) {
      if ((options as { all?: boolean } | undefined)?.all === true) {
        done(null, [{ address: '127.0.0.1', family: 4 }]);
      } else {
        done(null, '127.0.0.1', 4);
      }
      return;
    }
    (originalLookup as (...args: unknown[]) => void)(hostname, options, callback);
  }) as typeof dns.lookup;
}

beforeAll(async () => {
  upstream = createServer();
  wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket) => socket.on('message', (message) => socket.send(message)));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamPort = (upstream.address() as { port: number }).port;

  useLocalGameHost();

  proxy = mockttp.getLocal();
  await proxy.forAnyWebSocket().thenPassThrough();
  await trackGameSockets(proxy, new Set<string>(), tracker);
  await proxy.start(0);
});

afterAll(async () => {
  dns.lookup = originalLookup;
  await proxy?.stop();
  wss?.close();
  await new Promise<void>((resolve) => upstream?.close(() => resolve()));
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${GAME_HOST}:${upstreamPort}/ws`, {
      agent: new HttpProxyAgent(`http://127.0.0.1:${proxy.port}`),
    });
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

/** Lets the proxy's own event callbacks (dispatched on `setImmediate`) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

function reset() {
  opened.length = 0;
  closed.length = 0;
}

describe('tracking game sockets through the MITM proxy', () => {
  it('reports a clean close', async () => {
    reset();

    const socket = await connect();
    await new Promise<void>((resolve) => {
      socket.on('close', resolve);
      socket.close(1000, 'bye');
    });
    await settle();

    expect(opened).toHaveLength(1);
    expect(closed).toEqual(opened);
  });

  it('reports an unclean close, which mockttp sends as an abort', async () => {
    reset();

    const socket = await connect();
    socket.terminate();
    await settle();

    expect(opened).toHaveLength(1);
    expect(closed).toEqual(opened);
  });

  it('ignores an aborted request that was never a game socket', async () => {
    reset();

    // The upstream has no HTTP handler, so this request aborts with its own id —
    // which was never tracked and must not be reported as a socket close.
    const req = request({
      host: '127.0.0.1',
      port: proxy.port,
      method: 'GET',
      path: `http://${GAME_HOST}:${upstreamPort}/`,
      headers: { host: GAME_HOST },
    });
    req.on('error', () => undefined);
    req.end();
    await settle();
    req.destroy();
    await settle();

    expect(opened).toEqual([]);
    expect(closed).toEqual([]);
  });
});
