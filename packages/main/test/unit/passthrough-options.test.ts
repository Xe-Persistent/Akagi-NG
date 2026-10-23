import { describe, expect, it } from 'vitest';

import {
  buildPassthroughOptions,
  buildRequestOptions,
} from '../../src/services/capture/mitm-proxy.js';

function answerBeforeRequest(url: string) {
  const { beforeRequest } = buildRequestOptions(undefined);
  return beforeRequest({ url } as Parameters<typeof beforeRequest>[0]);
}

describe('the passthrough connection options', () => {
  // Enabling it makes mockttp load the native `tls-impersonate` module, which
  // aborts the Electron process on the first upstream TLS connection: the game
  // client's login killed the app with no JS error and nothing in the log.
  it('never asks mockttp to mirror the TLS fingerprint', () => {
    expect(buildPassthroughOptions(undefined)).not.toHaveProperty('mirrorTlsFingerprint');
    expect(buildPassthroughOptions('http://127.0.0.1:7890')).not.toHaveProperty(
      'mirrorTlsFingerprint',
    );
  });

  it('passes an upstream proxy through with loopback exempted', () => {
    expect(buildPassthroughOptions('  http://127.0.0.1:7890 ')).toEqual({
      proxyConfig: { proxyUrl: 'http://127.0.0.1:7890', noProxy: ['127.0.0.1', 'localhost'] },
    });
  });

  it('adds nothing when no upstream proxy is configured', () => {
    expect(buildPassthroughOptions('')).toEqual({});
    expect(buildPassthroughOptions(undefined)).toEqual({});
  });
});

describe('the request passthrough rule', () => {
  it('answers a telemetry beacon locally with the real endpoint empty 200', () => {
    expect(
      answerBeforeRequest(
        'https://proj.cn-hangzhou.log.aliyuncs.com/logstores/client/track?log_category=login',
      ),
    ).toEqual({ response: { statusCode: 200 } });
  });

  it('leaves an ordinary request alone', () => {
    expect(answerBeforeRequest('https://game.maj-soul.com/1/')).toBeUndefined();
    expect(
      answerBeforeRequest('https://proj.log.aliyuncs.com/logstores/client/index'),
    ).toBeUndefined();
  });

  it('keeps the upstream proxy configuration on the request leg', () => {
    expect(buildRequestOptions('http://127.0.0.1:7890')).toMatchObject({
      proxyConfig: { proxyUrl: 'http://127.0.0.1:7890', noProxy: ['127.0.0.1', 'localhost'] },
    });
  });
});
