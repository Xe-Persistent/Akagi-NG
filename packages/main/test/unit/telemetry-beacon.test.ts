import { describe, expect, it } from 'vitest';

import { isTelemetryBeacon } from '../../src/services/capture/mitm-proxy.js';

describe('the Aliyun SLS beacon recognizer', () => {
  it('matches the web-tracking endpoint on any host', () => {
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
  });

  it('leaves ordinary requests alone', () => {
    expect(isTelemetryBeacon('https://game.maj-soul.com/1/')).toBe(false);
    expect(isTelemetryBeacon('https://proj.log.aliyuncs.com/logstores/client/index')).toBe(false);
    expect(isTelemetryBeacon('https://proj.log.aliyuncs.com/logstores/tracking/index')).toBe(false);
  });
});
