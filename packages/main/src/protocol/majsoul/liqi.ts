import { readFileSync } from 'node:fs';

import * as protobuf from 'protobufjs';

import { createLogger } from '../../logging/index.js';
import { getAssetPath } from '../../shared/paths.js';
import { LiqiProtocolConstants } from './consts.js';

const logger = createLogger('Liqi');

export enum MsgType {
  Notify = 1,
  Req = 2,
  Res = 3,
}

export interface LiqiMessage {
  id: number;
  type: MsgType;
  method: string;
  data: Record<string, unknown>;
}

/** A decoded top-level protobuf field of a liqi frame payload. */
export type LiqiBlock =
  | { kind: 'varint'; id: number; begin: number; value: number }
  | { kind: 'bytes'; id: number; begin: number; bytes: Buffer };

interface LiqiRpcDescriptor {
  requestType: string;
  responseType?: string;
}

/** Shape of the protobuf-JS descriptor tree shipped as `assets/liqi.json`. */
interface LiqiJson {
  nested: Record<
    string,
    {
      nested: Record<
        string,
        {
          methods: Record<string, LiqiRpcDescriptor>;
        }
      >;
    }
  >;
}

/**
 * XOR key schedule used by the Majsoul client to scramble protobuf payloads.
 * Mirrors the client's own obfuscation; do not reorder.
 */
const WRAPPER_XOR_KEYS = [0x84, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c];

export function decodeWrapper(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const u = ((23 ^ data.length) + 5 * i + WRAPPER_XOR_KEYS[i % WRAPPER_XOR_KEYS.length]) & 255;
    result[i] = data[i] ^ u;
  }
  return result;
}

export function parseVarint(buf: Buffer, position: number): [number, number] {
  let value = 0;
  let multiplier = 1;
  let p = position;

  while (p < buf.length) {
    const byte = buf[p];
    // Arithmetic instead of `<<` so varints wider than 28 bits stay exact
    // (JS bitwise operators are 32-bit, Python's are arbitrary precision).
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    p++;
    if ((byte & 0x80) === 0) break;
  }

  return [value, p];
}

export function fromProtobuf(buf: Buffer): LiqiBlock[] {
  const blocks: LiqiBlock[] = [];
  let p = 0;

  while (p < buf.length) {
    const begin = p;
    const blockType = buf[p] & 7;
    const blockId = buf[p] >> 3;
    p++;

    if (blockType === LiqiProtocolConstants.BLOCK_TYPE_VARINT) {
      const [value, nextPosition] = parseVarint(buf, p);
      blocks.push({ kind: 'varint', id: blockId, begin, value });
      p = nextPosition;
    } else if (blockType === LiqiProtocolConstants.BLOCK_TYPE_STRING) {
      const [length, nextPosition] = parseVarint(buf, p);
      const bytes = buf.subarray(nextPosition, nextPosition + length);
      blocks.push({ kind: 'bytes', id: blockId, begin, bytes });
      p = nextPosition + length;
    } else {
      throw new Error(`Unknown protobuf block type: ${blockType}`);
    }
  }

  return blocks;
}

/**
 * Recursively converts `snake_case` object keys to `camelCase`.
 *
 * `protobufjs`'s `toObject` returns the descriptor field names (`is_liqi`,
 * `seat_list`, ...) while the game logic is written against the camelCase JSON
 * names the Python reference implementation received; normalizing here keeps
 * that contract in one place.
 */
function toCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toCamelCase(item));
  }

  if (
    value &&
    typeof value === 'object' &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Uint8Array)
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())] =
        toCamelCase(item);
    }
    return result;
  }

  return value;
}

export class LiqiProto {
  private root!: protobuf.Root;
  private jsonProto!: LiqiJson;
  /** msg_id of in-flight requests, needed to find the response type. */
  private readonly pendingRequests = new Map<
    number,
    { method: string; responseType: protobuf.Type | null }
  >();

  constructor() {
    this.reloadLiqi();
  }

  public reloadLiqi() {
    const liqiPath = getAssetPath('assets', 'liqi.json');
    this.jsonProto = JSON.parse(readFileSync(liqiPath, 'utf-8')) as LiqiJson;
    this.root = protobuf.Root.fromJSON(this.jsonProto as protobuf.INamespace);
    this.pendingRequests.clear();
    logger.info('Liqi protocol successfully loaded/reloaded.');
  }

  public getMessageClass(name: string): protobuf.Type | null {
    const found = this.root.lookup(`lq.${name}`);
    if (found instanceof protobuf.Type) {
      return found;
    }

    logger.warn(`Message type ${name} not found in protocol`);
    return null;
  }

  public parseWrapper(
    name: string,
    data: Uint8Array,
    useXor = true,
  ): Record<string, unknown> | null {
    const cls = this.getMessageClass(name);
    if (!cls) return null;

    const rawData = useXor ? decodeWrapper(data) : data;
    return this.decodeMessage(cls, rawData);
  }

  /** Decodes a message into a plain object with camelCase keys. */
  private decodeMessage(type: protobuf.Type, bytes: Uint8Array): Record<string, unknown> {
    const message = type.decode(bytes);
    const plain = type.toObject(message, { defaults: true, arrays: true, objects: true });
    return toCamelCase(plain) as Record<string, unknown>;
  }

  public parse(buf: Buffer): LiqiMessage | null {
    let msgId = -1;

    try {
      const msgType = buf[0] as MsgType;
      let method: string;
      let data: Record<string, unknown>;

      if (msgType === MsgType.Notify) {
        [method, data] = this.parseNotify(fromProtobuf(buf.subarray(1)));
      } else if (msgType === MsgType.Req || msgType === MsgType.Res) {
        msgId = buf.readUInt16LE(1);
        const blocks = fromProtobuf(buf.subarray(3));
        [method, data] =
          msgType === MsgType.Req
            ? this.parseRequest(msgId, blocks)
            : this.parseResponse(msgId, blocks);
      } else {
        logger.warn(`Unknown liqi msg type: ${msgType}`);
        return null;
      }

      return { id: msgId, type: msgType, method, data };
    } catch (e) {
      logger.debug(
        `Decode skipped: ${e instanceof Error ? e.message : String(e)} (msg_id: ${msgId}, type: ${buf[0]})`,
      );
      return null;
    }
  }

  private parseNotify(blocks: LiqiBlock[]): [string, Record<string, unknown>] {
    const methodName = this.readBytes(blocks, 0).toString('utf8');
    const messageName = methodName.split('.').pop() ?? methodName;

    const msgCls = this.getMessageClass(messageName);
    if (!msgCls) {
      throw new Error(`Unknown Notify Message: ${messageName}`);
    }

    const payload = this.readBytes(blocks, 1);
    const msg = msgCls.decode(payload);

    // ActionPrototype wraps the real action in a (name, data) pair.
    if (messageName === 'ActionPrototype' || (msg.name && msg.data)) {
      const innerName = msg.name as string;
      const innerDict = this.parseWrapper(innerName, msg.data as Uint8Array);
      if (innerDict !== null) {
        const result: Record<string, unknown> = { name: innerName, data: innerDict };
        if (msg.step !== undefined) result.step = msg.step;
        return [methodName, result];
      }
    }

    return [methodName, this.decodeMessage(msgCls, payload)];
  }

  private parseRequest(msgId: number, blocks: LiqiBlock[]): [string, Record<string, unknown>] {
    if (msgId >= 1 << 16) throw new Error(`msg_id ${msgId} exceeds max value`);
    if (blocks.length !== LiqiProtocolConstants.MSG_BLOCK_SIZE) {
      throw new Error(`Invalid msg_block size: ${blocks.length}`);
    }

    const methodName = this.readBytes(blocks, 0).toString('utf8');
    const descriptor = this.lookupRpc(methodName);
    if (!descriptor) {
      throw new Error(`Unknown RPC method: ${methodName}`);
    }

    if (this.pendingRequests.has(msgId)) {
      logger.debug(`Duplicate msg_id ${msgId}, overwriting previous request`);
    }

    const requestType = this.getMessageClass(descriptor.requestType);
    if (!requestType) {
      throw new Error(`Unknown Request Message: ${descriptor.requestType}`);
    }

    const data = this.decodeMessage(requestType, this.readBytes(blocks, 1));

    this.pendingRequests.set(msgId, {
      method: methodName,
      responseType: descriptor.responseType ? this.getMessageClass(descriptor.responseType) : null,
    });

    return [methodName, data];
  }

  private parseResponse(msgId: number, blocks: LiqiBlock[]): [string, Record<string, unknown>] {
    if (this.readBytes(blocks, 0).length !== LiqiProtocolConstants.EMPTY_DATA_LEN) {
      throw new Error('Response first block not empty');
    }

    const pending = this.pendingRequests.get(msgId);
    if (!pending) {
      throw new Error(`Response msg_id ${msgId} not found in pending requests`);
    }
    this.pendingRequests.delete(msgId);

    if (!pending.responseType) {
      throw new Error(`Unknown Response Message: ${pending.method}`);
    }

    const data = this.decodeMessage(pending.responseType, this.readBytes(blocks, 1));
    return [pending.method, data];
  }

  private lookupRpc(methodName: string): LiqiRpcDescriptor | null {
    // RPC names look like '.lq.FastTest.authGame'
    const [, namespace, service, rpc] = methodName.split('.');
    return this.jsonProto.nested[namespace]?.nested[service]?.methods[rpc] ?? null;
  }

  private readBytes(blocks: LiqiBlock[], index: number): Buffer {
    const block = blocks[index];
    if (!block || block.kind !== 'bytes') {
      throw new Error(`Expected bytes block at index ${index}`);
    }
    return block.bytes;
  }
}
