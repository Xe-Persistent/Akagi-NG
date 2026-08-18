import { readFileSync } from 'node:fs';

import * as protobuf from 'protobufjs';

import { createLogger } from '../../logger.js';
import { getAssetPath } from '../../utils.js';
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

export interface ProtoJSON {
  nested: Record<
    string,
    {
      nested: Record<
        string,
        {
          methods: Record<
            string,
            {
              requestType: string;
              responseType: string;
            }
          >;
        }
      >;
    }
  >;
}

const keys = [0x84, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c];

export function decodeWrapper(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const u = ((23 ^ data.length) + 5 * i + keys[i % keys.length]) & 255;
    result[i] = data[i] ^ u;
  }
  return result;
}

export function parseVarint(buf: Buffer, p: number): [number, number] {
  let data = 0;
  let base = 0;
  while (p < buf.length) {
    data += (buf[p] & 127) << base;
    base += 7;
    p++;
    if (buf[p - 1] >> 7 === 0) {
      break;
    }
  }
  return [data, p];
}

export function fromProtobuf(
  buf: Buffer,
): Array<{ id: number; type: string; data: unknown; begin: number }> {
  let p = 0;
  const result = [];
  while (p < buf.length) {
    const blockBegin = p;
    const blockType = buf[p] & 7;
    const blockId = buf[p] >> 3;
    p++;

    let blockTypeStr: string;
    let data: unknown;
    if (blockType === LiqiProtocolConstants.BLOCK_TYPE_VARINT) {
      blockTypeStr = 'varint';
      const parsed = parseVarint(buf, p);
      data = parsed[0];
      p = parsed[1];
    } else if (blockType === LiqiProtocolConstants.BLOCK_TYPE_STRING) {
      blockTypeStr = 'string';
      const parsed = parseVarint(buf, p);
      const sLen = parsed[0];
      p = parsed[1];
      data = buf.subarray(p, p + sLen);
      p += sLen;
    } else {
      throw new Error(`unknown pb block type: ${blockType}`);
    }

    result.push({
      id: blockId,
      type: blockTypeStr,
      data,
      begin: blockBegin,
    });
  }
  return result;
}

export class LiqiProto {
  private root!: protobuf.Root;
  private resType: Record<number, [string, protobuf.Type]> = {};
  public msgId = 1;
  public parsedMsgCount = 0;
  public lastHeartbeatTime = 0;
  private jsonProto!: ProtoJSON;

  constructor() {
    this.reloadLiqi();
  }

  public reloadLiqi() {
    const liqiPath = getAssetPath('assets', 'liqi.json');
    const content = readFileSync(liqiPath, 'utf-8');
    this.jsonProto = JSON.parse(content);
    this.root = protobuf.Root.fromJSON(this.jsonProto);
    this.init();
    logger.info('Liqi protocol successfully loaded/reloaded.');
  }

  public init() {
    this.msgId = 1;
    this.resType = {};
  }

  public getMessageClass(name: string): protobuf.Type | null {
    try {
      return this.root.lookupType(`lq.${name}`);
    } catch {
      logger.warn(`Message type ${name} not found in protocol`);
      return null;
    }
  }

  public parseWrapper(
    name: string,
    data: Uint8Array | Buffer,
    useXor = true,
  ): Record<string, unknown> | null {
    const cls = this.getMessageClass(name);
    if (!cls) return null;

    const rawData = useXor ? decodeWrapper(data as Uint8Array) : (data as Uint8Array);
    const msg = cls.decode(rawData);
    return cls.toObject(msg, { defaults: true, arrays: true, objects: true });
  }

  private parseNotify(
    msgBlock: Array<{ id: number; type: string; data: unknown; begin: number }>,
  ): [string, Record<string, unknown>] {
    const methodName = (msgBlock[0].data as Buffer).toString('utf8');
    const parts = methodName.split('.');
    const messageName = parts[parts.length - 1];

    const msgCls = this.getMessageClass(messageName);
    if (!msgCls) {
      throw new Error(`Unknown Notify Message: ${messageName}`);
    }

    const msg = msgCls.decode(msgBlock[1].data as Uint8Array);

    if (messageName === 'ActionPrototype' || (msg.name && msg.data)) {
      const innerName = msg.name as string;
      const innerDict = this.parseWrapper(innerName, msg.data as Uint8Array, true);
      if (innerDict !== null) {
        const resDict: Record<string, unknown> = { name: innerName, data: innerDict };
        if (msg.step !== undefined) resDict.step = msg.step;
        return [methodName, resDict];
      }
    }

    return [methodName, msgCls.toObject(msg, { defaults: true, arrays: true, objects: true })];
  }

  private parseRequest(
    msgId: number,
    msgBlock: Array<{ id: number; type: string; data: unknown; begin: number }>,
  ): [string, Record<string, unknown>] {
    if (msgId >= 1 << 16) throw new Error(`msg_id ${msgId} exceeds max value`);
    if (msgBlock.length !== LiqiProtocolConstants.MSG_BLOCK_SIZE) {
      throw new Error(`Invalid msg_block size: ${msgBlock.length}`);
    }

    if (this.resType[msgId]) {
      logger.debug(`Duplicate msg_id ${msgId}, overwriting previous request`);
      delete this.resType[msgId];
    }

    const methodName = (msgBlock[0].data as Buffer).toString('utf8');
    const parts = methodName.split('.');
    const lq = parts[1];
    const service = parts[2];
    const rpc = parts[3];

    if (service === 'Route' && rpc === 'heartbeat') {
      this.lastHeartbeatTime = Date.now() / 1000;
    }

    const protoDomain = this.jsonProto.nested[lq].nested[service].methods[rpc];
    const reqCls = this.getMessageClass(protoDomain.requestType);
    if (!reqCls) {
      throw new Error(`Unknown Request Message: ${protoDomain.requestType}`);
    }

    const msg = reqCls.decode(msgBlock[1].data as Uint8Array);
    const dictObj = reqCls.toObject(msg, { defaults: true, arrays: true, objects: true });

    const resCls = this.getMessageClass(protoDomain.responseType);
    if (resCls) {
      this.resType[msgId] = [methodName, resCls];
    }
    this.msgId = msgId;
    return [methodName, dictObj];
  }

  private parseResponse(
    msgId: number,
    msgBlock: Array<{ id: number; type: string; data: unknown; begin: number }>,
  ): [string, Record<string, unknown>] {
    if ((msgBlock[0].data as Buffer).length !== LiqiProtocolConstants.EMPTY_DATA_LEN) {
      throw new Error(
        `Response first block not empty, got ${(msgBlock[0].data as Buffer).length} bytes`,
      );
    }
    if (!this.resType[msgId]) {
      throw new Error(`Response msg_id ${msgId} not found in pending requests`);
    }

    const [methodName, resCls] = this.resType[msgId];
    delete this.resType[msgId];

    const msg = resCls.decode(msgBlock[1].data as Uint8Array);
    const dictObj = resCls.toObject(msg, { defaults: true, arrays: true, objects: true });
    return [methodName, dictObj];
  }

  public parse(buf: Buffer): LiqiMessage | null {
    let msgId = -1;
    try {
      const msgType = buf[0] as MsgType;
      let methodName = '';
      let dictObj: Record<string, unknown> = {};

      if (msgType === MsgType.Notify) {
        const msgBlock = fromProtobuf(buf.subarray(1));
        [methodName, dictObj] = this.parseNotify(msgBlock);
        msgId = -1;
      } else {
        msgId = buf.readUInt16LE(1);
        const msgBlock = fromProtobuf(buf.subarray(3));
        if (msgType === MsgType.Req) {
          this.msgId = msgId;
          [methodName, dictObj] = this.parseRequest(msgId, msgBlock);
        } else if (msgType === MsgType.Res) {
          [methodName, dictObj] = this.parseResponse(msgId, msgBlock);
        } else {
          logger.warn(`unknown msg type: ${msgType}`);
          return null;
        }
      }

      this.parsedMsgCount++;
      return { id: msgId, type: msgType, method: methodName, data: dictObj };
    } catch (e) {
      logger.debug(
        `Decode skipped: ${e instanceof Error ? e.message : String(e)} (msg_id: ${msgId}, type: ${buf[0]})`,
      );
      return null;
    }
  }
}
