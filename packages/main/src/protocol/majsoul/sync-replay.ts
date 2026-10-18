import { createLogger } from '../../logging/index.js';
import { MahjongConstants } from '../../shared/schema/mahjong.js';
import type { LiqiMessage, LiqiProto } from './liqi.js';
import { MsgType } from './liqi.js';

const logger = createLogger('MajsoulSync');

type Payload = Record<string, unknown>;

/**
 * The game mode is only known from the snapshot the reconnect carries, before
 * any action is replayed. Returns `null` when the frame has no snapshot.
 */
export function is3pFromSyncSnapshot(liqiMessage: LiqiMessage): boolean | null {
  const data = liqiMessage.data as Payload | undefined;
  const snapshot = (data?.gameRestore as Payload | undefined)?.snapshot as Payload | undefined;
  const players = snapshot?.players as unknown[] | undefined;
  if (!players) return null;

  const is3p = players.length === MahjongConstants.SEATS_3P;
  logger.verbose(`Pre-scanned mode from snapshot: is_3p=${is3p}`);
  return is3p;
}

/**
 * Unpacks the base64 action history of `gameRestore` into ActionPrototype
 * shaped messages so they can be replayed through the normal handlers.
 */
export function parseSyncGameActions(
  liqiMessage: LiqiMessage,
  liqiProto: LiqiProto,
): LiqiMessage[] {
  const messages: LiqiMessage[] = [];

  try {
    const data = liqiMessage.data as Payload | undefined;
    const restore = data?.gameRestore as Payload | undefined;
    if (!restore) return [];

    for (const action of (restore.actions ?? []) as Payload[]) {
      const item = parseSyncGameActionItem(action, liqiProto);
      if (item) messages.push(item);
    }
  } catch (e) {
    logger.error(`Error parsing sync game: ${e instanceof Error ? e.message : String(e)}`);
  }

  return messages;
}

function parseSyncGameActionItem(actionDict: Payload, liqiProto: LiqiProto): LiqiMessage | null {
  const innerName = actionDict.name as string;
  const rawData = Buffer.from(actionDict.data as string, 'base64');
  const innerDict = liqiProto.parseWrapper(innerName, rawData, false);

  if (!innerDict) return null;

  return {
    id: -1,
    type: MsgType.Notify,
    method: '.lq.ActionPrototype',
    data: { ...actionDict, data: innerDict },
  };
}
