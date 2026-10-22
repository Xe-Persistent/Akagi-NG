import { readFileSync } from 'node:fs';

import * as protobuf from 'protobufjs';

import { createLogger } from '../../logging/index.js';
import { errorMessage } from '../../shared/errors.js';
import { getAssetPath } from '../../shared/paths.js';

const logger = createLogger('Liqi');

/** Protobuf wire types, read from the low three bits of a field tag. */
const WIRE_VARINT = 0;
const WIRE_BYTES = 2;

/** A request wrapper is exactly two blocks: the method name and its payload. */
const REQUEST_BLOCK_COUNT = 2;

export enum MsgType {
  Notify = 1,
  Req = 2,
  Res = 3,
}

/** The frame types this decoder understands; any other byte is another protocol. */
const LIQI_FRAME_TYPES = new Map<number, MsgType>([
  [MsgType.Notify, MsgType.Notify],
  [MsgType.Req, MsgType.Req],
  [MsgType.Res, MsgType.Res],
]);

export interface LiqiMessage {
  id: number;
  type: MsgType;
  method: string;
  data: Record<string, unknown>;
}

/**
 * What decoding one captured frame produced: a game message, a frame that is
 * not liqi at all (e.g. another protocol sharing the socket), or a liqi frame
 * this build failed to decode.
 */
export type LiqiParseResult =
  | { kind: 'message'; message: LiqiMessage }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: string };

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

/**
 * Upper bound on remembered in-flight requests. A response that never arrives
 * would otherwise keep its entry for the rest of the session.
 */
const MAX_PENDING_REQUESTS = 256;

/**
 * A valid liqi frame this build cannot map — an unknown message class, an RPC
 * the extracted descriptor lacks, or a response whose request predates the
 * capture. These are expected protocol gaps, not malformed data, so they are
 * skipped without surfacing a parse failure.
 */
class UnsupportedLiqiFrame extends Error {}

/** Reads a byte the caller has bounds-checked; a short buffer means bad input. */
function readByte(buf: Uint8Array, index: number): number {
  const byte = buf[index];
  if (byte === undefined) throw new Error('liqi: read past the end of the frame');
  return byte;
}

export function decodeWrapper(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (const [i, byte] of data.entries()) {
    const u =
      ((23 ^ data.length) + 5 * i + (WRAPPER_XOR_KEYS[i % WRAPPER_XOR_KEYS.length] ?? 0)) & 255;
    result[i] = byte ^ u;
  }
  return result;
}

export function parseVarint(buf: Buffer, position: number): [number, number] {
  let value = 0;
  let multiplier = 1;
  let p = position;

  while (p < buf.length) {
    const byte = readByte(buf, p);
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
    const header = readByte(buf, p);
    const blockType = header & 7;
    const blockId = header >> 3;
    p++;

    if (blockType === WIRE_VARINT) {
      const [value, nextPosition] = parseVarint(buf, p);
      blocks.push({ kind: 'varint', id: blockId, begin, value });
      p = nextPosition;
    } else if (blockType === WIRE_BYTES) {
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

  public parse(buf: Buffer): LiqiParseResult {
    let msgId = -1;

    try {
      // A raw byte: the socket carries other protocols too, and the value is
      // what tells them apart.
      const frameType = buf[0];
      if (frameType === undefined) return { kind: 'skipped' };
      const liqiType = LIQI_FRAME_TYPES.get(frameType);
      if (liqiType === undefined) {
        // A socket that carries more than liqi: not an error worth reporting.
        logger.verbose(`Skipping a non-liqi frame (type ${frameType})`);
        return { kind: 'skipped' };
      }

      let method: string;
      let data: Record<string, unknown>;

      if (liqiType === MsgType.Notify) {
        [method, data] = this.parseNotify(fromProtobuf(buf.subarray(1)));
      } else {
        msgId = buf.readUInt16LE(1);
        const blocks = fromProtobuf(buf.subarray(3));
        [method, data] =
          liqiType === MsgType.Req
            ? this.parseRequest(msgId, blocks)
            : this.parseResponse(msgId, blocks);
      }

      return { kind: 'message', message: { id: msgId, type: liqiType, method, data } };
    } catch (e) {
      const reason = errorMessage(e);
      if (e instanceof UnsupportedLiqiFrame) {
        logger.verbose(`Skipping an unsupported liqi frame: ${reason}`);
        return { kind: 'skipped' };
      }
      // Recorded at the capture level, so a survey of a log can tell how many
      // frames were dropped and why.
      logger.verbose(`Decode failed: ${reason} (msg_id: ${msgId}, type: ${buf[0]})`);
      return { kind: 'failed', reason };
    }
  }

  private parseNotify(blocks: LiqiBlock[]): [string, Record<string, unknown>] {
    const methodName = this.readBytes(blocks, 0).toString('utf8');
    const messageName = methodName.split('.').pop() ?? methodName;

    const msgCls = this.getMessageClass(messageName);
    if (!msgCls) {
      throw new UnsupportedLiqiFrame(`Unknown Notify Message: ${messageName}`);
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
    if (blocks.length !== REQUEST_BLOCK_COUNT) {
      throw new Error(`Invalid msg_block size: ${blocks.length}`);
    }

    const methodName = this.readBytes(blocks, 0).toString('utf8');
    const descriptor = this.lookupRpc(methodName);
    if (!descriptor) {
      throw new UnsupportedLiqiFrame(`Unknown RPC method: ${methodName}`);
    }

    if (this.pendingRequests.has(msgId)) {
      logger.verbose(`Duplicate msg_id ${msgId}, overwriting previous request`);
    }

    const requestType = this.getMessageClass(descriptor.requestType);
    if (!requestType) {
      throw new UnsupportedLiqiFrame(`Unknown Request Message: ${descriptor.requestType}`);
    }

    const data = this.decodeMessage(requestType, this.readBytes(blocks, 1));

    this.pendingRequests.set(msgId, {
      method: methodName,
      responseType: descriptor.responseType ? this.getMessageClass(descriptor.responseType) : null,
    });
    this.prunePendingRequests();

    return [methodName, data];
  }

  /** Drops the oldest requests once the map is full; a lost response never frees its own. */
  private prunePendingRequests() {
    while (this.pendingRequests.size > MAX_PENDING_REQUESTS) {
      const oldest = this.pendingRequests.keys().next().value;
      if (oldest === undefined) return;
      this.pendingRequests.delete(oldest);
      logger.verbose(`Dropping stale request msg_id ${oldest} (no response arrived)`);
    }
  }

  private parseResponse(msgId: number, blocks: LiqiBlock[]): [string, Record<string, unknown>] {
    // The first block of a response is a placeholder the client never fills.
    if (this.readBytes(blocks, 0).length !== 0) {
      throw new Error('Response first block not empty');
    }

    const pending = this.pendingRequests.get(msgId);
    if (!pending) {
      throw new UnsupportedLiqiFrame(`Response msg_id ${msgId} not found in pending requests`);
    }
    this.pendingRequests.delete(msgId);

    if (!pending.responseType) {
      throw new UnsupportedLiqiFrame(`Unknown Response Message: ${pending.method}`);
    }

    const data = this.decodeMessage(pending.responseType, this.readBytes(blocks, 1));
    return [pending.method, data];
  }

  private lookupRpc(methodName: string): LiqiRpcDescriptor | null {
    // RPC names look like '.lq.FastTest.authGame'
    const [, namespace, service, rpc] = methodName.split('.');
    if (namespace === undefined || service === undefined || rpc === undefined) return null;
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
