import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as mockttp from 'mockttp';

import { createLogger } from '../../logging/index.js';

const logger = createLogger('Certificates');

/** Where the MITM proxy keeps its CA, and the format each consumer needs. */
export interface CertificatePaths {
  /** Private key, read by the proxy. */
  keyPath: string;
  /** PEM certificate, read by the proxy and by command-line tools. */
  pemPath: string;
  /** DER certificate, which Windows' certificate wizard can open directly. */
  cerPath: string;
}

/** Concurrent callers share one generation run. */
const pending = new Map<string, Promise<CertificatePaths>>();

/**
 * Creates the CA on first use and refreshes the DER copy the Windows wizard
 * needs. An existing key is never replaced, so clients that already trust this
 * CA keep working across restarts.
 */
export function ensureCertificates(certsDir: string): Promise<CertificatePaths> {
  const running = pending.get(certsDir);
  if (running) return running;

  const task = createCertificates(certsDir).finally(() => pending.delete(certsDir));
  pending.set(certsDir, task);
  return task;
}

async function createCertificates(certsDir: string): Promise<CertificatePaths> {
  mkdirSync(certsDir, { recursive: true });

  const keyPath = join(certsDir, 'akagi-ng-ca.key');
  const pemPath = join(certsDir, 'akagi-ng-ca.pem');
  const cerPath = join(certsDir, 'akagi-ng-ca.cer');

  if (!existsSync(keyPath) || !existsSync(pemPath)) {
    logger.info('Generating new CA certificates for MITM proxy...');
    const { key, cert } = await mockttp.generateCACertificate({
      subject: {
        commonName: 'Akagi-NG Proxy CA',
        organizationName: 'Akagi-NG',
        countryName: 'CN',
      },
    });
    await writeFile(keyPath, key, { mode: 0o600 });
    await writeFile(pemPath, cert);
    logger.info(`CA certificates generated at ${certsDir}`);
  } else {
    logger.info(`Using existing CA certificates at ${certsDir}`);
  }

  // The private key is the only secret here; keep it owner-only on POSIX.
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    // Windows ignores POSIX modes.
  }

  // Windows does not associate the PEM with its certificate wizard, so keep a
  // DER copy next to it; every other consumer still reads the PEM.
  const certificate = new X509Certificate(await readFile(pemPath));
  await writeFile(cerPath, certificate.raw);

  return { keyPath, pemPath, cerPath };
}
