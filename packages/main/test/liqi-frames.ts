/**
 * Builds liqi frames the way the game client sends them, so the bridge can be
 * driven without a live table. The descriptor comes from `assets/liqi.json`, the
 * same file the app loads at runtime.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as protobuf from 'protobufjs';

import { decodeWrapper } from '../src/protocol/majsoul/liqi.js';

const liqiJson = fileURLToPath(new URL('../../../assets/liqi.json', import.meta.url));
const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(liqiJson, 'utf8')));

/** Encodes one `lq.*` message from a plain object. */
export function encodeMessage(name: string, value: Record<string, unknown>): Buffer {
  const type = root.lookupType(`lq.${name}`);
  const error = type.verify(value);
  if (error) throw new Error(`${name}: ${error}`);
  return Buffer.from(type.encode(type.create(value)).finish());
}

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

function bytesField(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

/** A `Notify` frame: what the server pushes for an action. */
export function notifyFrame(method: string, payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([1]),
    bytesField(1, Buffer.from(method, 'utf8')),
    bytesField(2, payload),
  ]);
}

/**
 * An `ActionPrototype` notify carrying a real action. Its payload is scrambled
 * the way the client expects, exactly as it arrives on the wire.
 */
export function actionFrame(actionName: string, action: Record<string, unknown>): Buffer {
  const scrambled = Buffer.from(decodeWrapper(new Uint8Array(encodeMessage(actionName, action))));
  const prototype = encodeMessage('ActionPrototype', { name: actionName, data: scrambled });
  return notifyFrame('.lq.ActionPrototype', prototype);
}

function idFrame(type: number, msgId: number, payload: Buffer): Buffer {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(msgId);
  return Buffer.concat([
    Buffer.from([type]),
    id,
    bytesField(1, Buffer.alloc(0)),
    bytesField(2, payload),
  ]);
}

/** A `Req` frame: what the client asks the server. */
export function requestFrame(method: string, msgId: number, payload: Buffer): Buffer {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(msgId);
  return Buffer.concat([
    Buffer.from([2]),
    id,
    bytesField(1, Buffer.from(method, 'utf8')),
    bytesField(2, payload),
  ]);
}

/** A `Res` frame: the server's answer to a `Req` with the same id. */
export function responseFrame(msgId: number, payload: Buffer): Buffer {
  return idFrame(3, msgId, payload);
}

/** The decoded payload of a `syncGame` / `enterGame` response. */
export interface RestorePayload {
  is_end?: boolean;
  step?: number;
  game_restore?: {
    actions?: { name?: string; data?: string; step?: number }[];
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

/**
 * A reconnect answer carrying a `game_restore`. The action payloads stay base64
 * inside the protobuf, exactly as the server stores them -- unlike a live
 * `ActionPrototype`, they are not scrambled.
 */
export function restoreFrames(
  game: 'syncGame' | 'enterGame',
  payload: RestorePayload,
  msgId = 1,
): [Buffer, Buffer] {
  const restore = payload.game_restore;
  const encoded = encodeMessage(game === 'syncGame' ? 'ResSyncGame' : 'ResEnterGame', {
    ...payload,
    ...(restore
      ? {
          game_restore: {
            ...restore,
            actions: (restore.actions ?? []).map((action) => ({
              ...action,
              data: action.data === undefined ? undefined : Buffer.from(action.data, 'base64'),
            })),
          },
        }
      : {}),
  });

  return [
    requestFrame(`.lq.FastTest.${game}`, msgId, Buffer.alloc(0)),
    responseFrame(msgId, encoded),
  ];
}
