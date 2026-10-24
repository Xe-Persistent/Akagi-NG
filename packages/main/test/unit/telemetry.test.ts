import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';

import { blockTelemetry } from '../../src/services/capture/telemetry.js';

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
