import type { BrowserWindow } from 'electron';

import { createLogger } from '../../logging/index.js';
import { getCertificatesDir } from '../../shared/paths.js';
import { getMitmPort } from '../settings-manager.js';
import { stopTrustingOurProxy, trustOurProxy } from './certificates.js';
import { blockTelemetry } from './telemetry.js';

const logger = createLogger('GameSession');

/**
 * The game runs in its own persistent session, so its proxy and permission
 * rules cannot leak into the dashboard or the HUD, and its login survives a
 * restart.
 */
export const GAME_PARTITION = 'persist:game';

/**
 * Capabilities the game page may request. Everything else — camera,
 * microphone, geolocation, notifications, clipboard reads, external protocol
 * launches, HID/USB/serial — is refused: this window shows remote content and
 * has no business reaching them.
 */
const ALLOWED_PERMISSIONS = new Set<string>([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
]);

/** Remote content gets no capability we do not explicitly need. */
export function hardenGameSession(window: BrowserWindow): void {
  const session = window.webContents.session;

  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));

  blockTelemetry(session);
}

/**
 * Points the window at our loopback proxy and trusts the TLS it re-signs.
 *
 * The proxy is always addressed over loopback, whatever the machine's network
 * interfaces look like.
 */
export async function routeThroughMitmProxy(window: BrowserWindow): Promise<void> {
  const { session } = window.webContents;
  const proxyRules = `http://127.0.0.1:${getMitmPort()}`;

  logger.info(`Routing game traffic through MITM proxy: ${proxyRules}`);
  await trustOurProxy(session, getCertificatesDir());
  await session.setProxy({ proxyRules, proxyBypassRules: '127.0.0.1,localhost' });
}

/** Clears a proxy — and a trust — left behind by an earlier MITM run. */
export async function routeDirect(window: BrowserWindow): Promise<void> {
  const { session } = window.webContents;

  stopTrustingOurProxy(session);
  await session.setProxy({ mode: 'direct' });
}
