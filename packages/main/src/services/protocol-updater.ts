import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '../logging/index.js';
import { bridgeManager } from '../protocol/bridge-manager.js';
import { getAssetPath } from '../shared/paths.js';

const logger = createLogger('Protocol');

const MAJSOUL_BASE_URL = 'https://game.maj-soul.com/1';

/**
 * Downloads the protobuf definition the game currently uses, stores it in
 * `assets/liqi.json` and reloads it in the active bridge.
 */
export async function updateMajsoulProtocol(): Promise<void> {
  logger.info('Fetching the Majsoul protocol definition...');

  const versionRes = await fetch(`${MAJSOUL_BASE_URL}/version.json`);
  if (!versionRes.ok) throw new Error(`Failed to fetch version.json: ${versionRes.status}`);
  const { version } = (await versionRes.json()) as { version: string };

  const mappingRes = await fetch(`${MAJSOUL_BASE_URL}/resversion${version}.json`);
  if (!mappingRes.ok) throw new Error(`Failed to fetch res mapping: ${mappingRes.status}`);
  const mapping = (await mappingRes.json()) as { res: Record<string, { prefix: string }> };

  const prefix = mapping.res['res/proto/liqi.json']?.prefix;
  if (!prefix) throw new Error('Could not find res/proto/liqi.json in mapping.');

  const liqiRes = await fetch(`${MAJSOUL_BASE_URL}/${prefix}/res/proto/liqi.json`);
  if (!liqiRes.ok) throw new Error(`Failed to fetch liqi.json: ${liqiRes.status}`);
  const liqi = JSON.parse(await liqiRes.text());

  await writeFile(
    join(getAssetPath('assets'), 'liqi.json'),
    `${JSON.stringify(liqi, null, 2)}\n`,
    'utf8',
  );
  bridgeManager.hotReloadLiqi();

  logger.info('Protocol definition updated.');
}
