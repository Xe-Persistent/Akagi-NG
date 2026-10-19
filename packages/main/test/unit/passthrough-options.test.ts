import { describe, expect, it } from 'vitest';

import { buildPassthroughOptions } from '../../src/services/capture/mitm-proxy.js';

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
