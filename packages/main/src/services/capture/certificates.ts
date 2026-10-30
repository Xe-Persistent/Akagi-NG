import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Session } from 'electron';
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

/**
 * Teaches a session to accept the TLS our own proxy re-signs.
 *
 * Granted explicitly rather than through the OS root store, which goes stale the
 * moment the CA is regenerated — asking the user to re-install a certificate to
 * play in our own window would be absurd.
 *
 * Only certificates this CA actually signed are accepted. One that merely claims
 * the same issuer name falls through to Chromium's own verdict, so this cannot
 * be used to bypass verification for anyone else.
 */
export async function trustOurProxy(session: Session, certsDir: string): Promise<void> {
  try {
    const { pemPath } = await ensureCertificates(certsDir);
    const ca = new X509Certificate(readFileSync(pemPath));

    session.setCertificateVerifyProc((request, callback) => {
      try {
        const leaf = new X509Certificate(request.certificate.data);
        if (leaf.checkIssued(ca) && leaf.verify(ca.publicKey)) {
          callback(0);
          return;
        }
      } catch {
        // Unreadable certificate: let Chromium decide.
      }
      callback(-3);
    });
  } catch (err) {
    logger.error('Failed to trust our own CA in the session:', err);
  }
}

/** Drops the handler `trustOurProxy` installed. */
export function stopTrustingOurProxy(session: Session): void {
  session.setCertificateVerifyProc(null);
}
