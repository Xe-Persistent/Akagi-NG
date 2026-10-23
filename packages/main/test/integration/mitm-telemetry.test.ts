import { request } from 'node:http';

import * as mockttp from 'mockttp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRequestOptions } from '../../src/services/capture/mitm-proxy.js';

let server: mockttp.Mockttp;

beforeAll(async () => {
  server = mockttp.getLocal();
  await server.forAnyRequest().thenPassThrough(buildRequestOptions(undefined));
  await server.start(0);
});

afterAll(async () => {
  await server.stop();
});

/** Sends an absolute-form request at the proxy, the way a browser proxy client does. */
function throughProxy(path: string): Promise<{ statusCode?: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: server.port,
        method: 'GET',
        path,
        headers: { host: 'proj.log.aliyuncs.com' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('the proxy telemetry rule', () => {
  it('answers a beacon locally without dialing the analytics host', async () => {
    const response = await throughProxy(
      'http://proj.log.aliyuncs.com/logstores/client/track?log_category=login',
    );

    expect(response).toEqual({ statusCode: 200, body: '' });
  });
});
