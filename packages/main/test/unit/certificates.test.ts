import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureCertificates } from '../../src/services/capture/certificates.js';

let certsDir: string;

describe('the MITM certificate store', () => {
  beforeEach(() => {
    certsDir = mkdtempSync(join(tmpdir(), 'akagi-certs-'));
  });

  afterEach(() => {
    rmSync(certsDir, { recursive: true, force: true });
  });

  it('writes the key, the PEM and a DER copy Windows can open', async () => {
    const paths = await ensureCertificates(certsDir);

    expect(readFileSync(paths.keyPath, 'utf8')).toContain('PRIVATE KEY');
    expect(readFileSync(paths.pemPath, 'utf8')).toContain('BEGIN CERTIFICATE');

    const certificate = new X509Certificate(readFileSync(paths.cerPath));
    expect(certificate.subject).toContain('CN=Akagi-NG Proxy CA');
    expect(certificate.ca).toBe(true);
  });

  it('reuses the certificate it generated the first time', async () => {
    const first = new X509Certificate(readFileSync((await ensureCertificates(certsDir)).pemPath));
    const second = new X509Certificate(readFileSync((await ensureCertificates(certsDir)).pemPath));

    expect(second.raw.equals(first.raw)).toBe(true);
  });
});
