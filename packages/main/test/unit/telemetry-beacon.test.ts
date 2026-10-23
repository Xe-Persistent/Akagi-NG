import { describe, expect, it } from 'vitest';

import { isTelemetryBeacon } from '../../src/services/capture/telemetry.js';

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
