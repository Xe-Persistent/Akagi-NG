import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';

import { blockTelemetry, isTelemetryBeacon } from '../../src/services/capture/telemetry.js';

/** The session surface `blockTelemetry` touches, recorded instead of registered. */
function fakeSession() {
  const registered: {
    filter?: { urls: string[] };
    listener?: (
      details: { url: string },
      callback: (response: { cancel?: boolean }) => void,
    ) => void;
    registrations: number;
  } = { registrations: 0 };

  const session = {
    webRequest: {
      onBeforeRequest: (
        filter: { urls: string[] },
        listener: (details: { url: string }, callback: (r: { cancel?: boolean }) => void) => void,
      ) => {
        registered.filter = filter;
        registered.listener = listener;
        registered.registrations += 1;
      },
    },
  };

  return { session, registered };
}

describe('blocking the game telemetry', () => {
  it('watches the whole Aliyun SLS service domain', () => {
    const { session, registered } = fakeSession();

    blockTelemetry(session as unknown as Session);

    // Chromium match patterns match `log.aliyuncs.com` and any depth below it,
    // and never a lookalike such as `log.aliyuncs.com.evil.test`.
    expect(registered.filter?.urls).toEqual(['*://*.log.aliyuncs.com/*']);
  });

  it('cancels every request it is handed', () => {
    const { session, registered } = fakeSession();
    blockTelemetry(session as unknown as Session);

    let response: { cancel?: boolean } | undefined;
    registered.listener?.(
      { url: 'https://proj.cn-hongkong.log.aliyuncs.com/logstores/client/track?a=1' },
      (r) => {
        response = r;
      },
    );

    expect(response).toEqual({ cancel: true });
  });

  it('wires a reopened window session only once', () => {
    const { session, registered } = fakeSession();
    const target = session as unknown as Session;

    blockTelemetry(target);
    blockTelemetry(target);

    expect(registered.registrations).toBe(1);
  });
});

/**
 * The request leg of the proxy cannot rely on the session handler above — an
 * external browser or game client routed through it has no Electron session —
 * so it recognises the same beacons by URL instead.
 */
describe('the Aliyun SLS beacon recognizer', () => {
  it('matches the web-tracking endpoint on the service domain', () => {
    expect(
      isTelemetryBeacon(
        'https://proj.cn-hangzhou.log.aliyuncs.com/logstores/client/track?log_category=login&content=%5B%5D',
      ),
    ).toBe(true);
    expect(
      isTelemetryBeacon(
        'https://other.log.aliyuncs.com/logstores/client-route-ab-test/track_ua.gif?x=1',
      ),
    ).toBe(true);
    expect(isTelemetryBeacon('http://log.aliyuncs.com/logstores/client/track')).toBe(true);
  });

  it('leaves ordinary SLS paths alone', () => {
    expect(isTelemetryBeacon('https://proj.log.aliyuncs.com/logstores/client/index')).toBe(false);
    expect(isTelemetryBeacon('https://proj.log.aliyuncs.com/logstores/tracking/index')).toBe(false);
  });

  it('leaves the same path on another host alone', () => {
    expect(isTelemetryBeacon('https://game.maj-soul.com/1/')).toBe(false);
    expect(isTelemetryBeacon('https://example.test/logstores/client/track')).toBe(false);
  });

  it('does not match a lookalike host', () => {
    expect(
      isTelemetryBeacon('https://proj.log.aliyuncs.com.evil.test/logstores/client/track'),
    ).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(isTelemetryBeacon('not a url')).toBe(false);
  });
});
