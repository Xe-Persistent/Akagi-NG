import { ipcMain } from 'electron';

import { createLogger } from '../../logging/index.js';
import {
  clampReactTimeout,
  DEFAULT_BASE_URL,
  InferenceClient,
  InferenceError,
} from '../../services/online/inference-client.js';
import { PurchaseManager } from '../../services/online/purchase-manager.js';
import {
  clearApiKey,
  isEncryptionAvailable,
  readApiKey,
  readKeyInfo,
  writeApiKey,
} from '../../services/online/secret-store.js';
import type {
  KeyInfo,
  KeyStatus,
  RedeemOutcome,
  RemoteModel,
  ServerHealth,
} from '../../services/online/types.js';
import { getSettingsManager } from '../../services/settings-manager.js';
import { errorMessage } from '../../shared/errors.js';

const logger = createLogger('IPC');

/** A failure the settings page can show as-is, instead of a stack trace. */
export interface OnlineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function attempt<T>(label: string, run: () => Promise<T>): Promise<OnlineResult<T>> {
  try {
    return { success: true, data: await run() };
  } catch (error) {
    // `InferenceError` messages are already redacted and user-readable.
    const message = error instanceof InferenceError ? error.message : errorMessage(error);
    logger.warn(`${label} failed: ${message}`);
    return { success: false, error: message };
  }
}

/** A client for a key the caller is about to store, so it can be validated first. */
function clientFor(apiKey: string): InferenceClient {
  const settings = getSettingsManager().getSettings();
  return new InferenceClient({
    apiKey,
    baseUrl: DEFAULT_BASE_URL,
    reactTimeoutMs: clampReactTimeout(settings.ot.react_timeout_ms),
  });
}

/**
 * The online model's management surface: key handling, the plan and model
 * lists, health, redemption and the Creem purchase flow.
 *
 * The key never travels to the renderer: it goes in through `online:set-key`,
 * is written to encrypted storage, and comes back only as "configured" plus its
 * last four characters. Inference itself is not here — the decision path calls
 * the service directly.
 */
export function registerOnlineHandlers() {
  const purchases = new PurchaseManager({ getBaseUrl: () => DEFAULT_BASE_URL });

  ipcMain.handle('online:key-info', (): KeyInfo => readKeyInfo());

  /** Store a key, but only one the server accepts: a typo would otherwise only
   *  surface as a silent fallback mid-game. */
  ipcMain.handle('online:set-key', (_event, key: unknown): Promise<OnlineResult<KeyStatus>> => {
    return attempt('Storing the API key', async () => {
      if (typeof key !== 'string' || !key.trim()) throw new Error('The API key is empty');
      if (!isEncryptionAvailable()) {
        throw new Error('Secure credential storage is unavailable on this system');
      }

      const client = clientFor(key);
      const status = await client.keyStatus();
      writeApiKey(key);
      return status;
    });
  });

  ipcMain.handle('online:clear-key', () => {
    clearApiKey();
    purchases.cancel();
    return readKeyInfo();
  });

  ipcMain.handle('online:key-status', (): Promise<OnlineResult<KeyStatus>> => {
    return attempt('Reading the key status', () => clientFor(readApiKey()).keyStatus());
  });

  ipcMain.handle('online:models', (): Promise<OnlineResult<RemoteModel[]>> => {
    return attempt('Reading the model list', () => clientFor(readApiKey()).models());
  });

  ipcMain.handle('online:health', (): Promise<OnlineResult<ServerHealth>> => {
    return attempt('Checking the service health', () => InferenceClient.health(DEFAULT_BASE_URL));
  });

  /**
   * Exchange a code for a key, or stack its time onto the key already stored.
   *
   * A minted key is stored right away — the service shows it once, so a round
   * trip through the renderer would risk losing it. A renewal returns no key at
   * all: it is the stored one being extended, which is why `renew` is a flag
   * here rather than a key the renderer would have had to hold.
   */
  ipcMain.handle(
    'online:redeem',
    (
      _event,
      code: unknown,
      email: unknown,
      renew: unknown,
    ): Promise<OnlineResult<RedeemOutcome>> => {
      return attempt('Redeeming the code', async () => {
        if (typeof code !== 'string' || !code.trim()) throw new Error('The code is empty');
        const options: { email?: string; renewKey?: string } = {};
        if (typeof email === 'string' && email.trim()) options.email = email;

        // A renewal extends the key we already hold. The renderer never sees it,
        // so the choice arrives as a flag and the key is read here.
        if (renew === true) {
          const existing = readApiKey();
          if (!existing) throw new Error('There is no stored key to renew');
          options.renewKey = existing;
        }

        const result = await clientFor('').redeem(code, options);
        // A renewal carries no new key: the service extended the one we sent.
        if (result.key) {
          writeApiKey(result.key);
        } else if (!result.extended) {
          throw new Error('The code was accepted but no key was returned');
        }

        // Verified, not assumed: the plan shown is what the server reports for
        // the key that is now stored. If that call fails the redeem itself still
        // succeeded (the code is spent), so its own numbers are used instead.
        const stored = readApiKey();
        const status = await clientFor(stored)
          .keyStatus()
          .catch(() => null);

        return {
          keyLast4: stored.slice(-4) || result.keyLast4,
          plan: status?.plan ?? result.plan,
          expiresAt: status?.expiresAt ?? result.expiresAt,
          extended: result.extended,
        };
      });
    },
  );

  ipcMain.handle('online:start-purchase', (_event, product: unknown) => {
    return attempt('Starting the checkout', async () => {
      if (typeof product !== 'string') throw new Error('Unknown product');
      return purchases.start(product);
    });
  });

  /**
   * A checkout the app opened earlier and never collected: the buyer may have
   * paid while the window was closed, and the claim secret is the only way back.
   */
  ipcMain.handle('online:pending-purchase', () => {
    const product = purchases.pendingProduct;
    return { success: true, data: product ? { product } : null };
  });

  ipcMain.handle('online:poll-purchase', () =>
    attempt('Polling the checkout', () => purchases.poll()),
  );
}
