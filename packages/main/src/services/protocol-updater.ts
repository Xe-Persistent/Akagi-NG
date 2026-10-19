import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '../logging/index.js';
import {
  bootstrapMajsoulProtocol,
  type BootstrapResult,
  type LiqiDescriptorJson,
} from '../protocol/bootstrap/index.js';
import { bridgeManager } from '../protocol/bridge-manager.js';
import { getAssetPath } from '../shared/paths.js';

const logger = createLogger('Protocol');

/**
 * Rebuilds `assets/liqi.json` from the protocol descriptors of the live Unity
 * client and hot-reloads it in the bridge.
 *
 * The game's own bundles are the only authoritative source: the
 * `res/proto/liqi.json` CDN resource is a leftover of the old Laya client and
 * lags behind the shipping build.
 */
export async function updateMajsoulProtocol(): Promise<BootstrapResult> {
  logger.info('Extracting the Majsoul protocol from the Unity client...');

  const previous = await readShippedDescriptor();
  const result = await bootstrapMajsoulProtocol({
    log: logger,
    previousDescriptor: previous,
  });

  for (const line of result.diff) logger.info(`Protocol diff: ${line}`);
  for (const warning of result.warnings) logger.warn(`Protocol check: ${warning}`);

  const assetsDir = getAssetPath('assets');
  await writeFile(
    join(assetsDir, 'liqi.json'),
    `${JSON.stringify(result.descriptor, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(assetsDir, 'liqi.meta.json'),
    `${JSON.stringify(result.meta, null, 2)}\n`,
    'utf8',
  );
  bridgeManager.hotReloadLiqi();

  logger.info(
    `Protocol updated to client ${result.meta.productVersion}: ` +
      `${result.stats.messages} message(s), ${result.stats.methods} rpc route(s)`,
  );
  return result;
}

async function readShippedDescriptor(): Promise<LiqiDescriptorJson | null> {
  try {
    const raw = await readFile(getAssetPath('assets', 'liqi.json'), 'utf8');
    return JSON.parse(raw) as LiqiDescriptorJson;
  } catch (error) {
    logger.warn(`Could not read the previous protocol: ${String(error)}`);
    return null;
  }
}
