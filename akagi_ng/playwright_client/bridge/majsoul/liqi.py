import base64
import json
import os
import struct
from enum import Enum

from google.protobuf.json_format import MessageToDict, ParseDict

from .liqi_proto import liqi_pb2 as pb
from ..logger import logger


class MsgType(Enum):
    Notify = 1
    Req = 2
    Res = 3


keys = [0x84, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c]


def decode(data: bytes):
    data = bytearray(data)
    for i in range(len(data)):
        u = (23 ^ len(data)) + 5 * i + keys[i % len(keys)] & 255
        data[i] ^= u
    return bytes(data)


# Just XOR it back
def encode(data: bytes):
    data = bytearray(data)
    for i in range(len(data)):
        u = (23 ^ len(data)) + 5 * i + keys[i % len(keys)] & 255
        data[i] ^= u
    return bytes(data)


class LiqiProto:

    def __init__(self):
        self.msg_id = 1
        self.tot = 0
        self.res_type = dict()
        self.jsonProto = json.load(
            open(os.path.join(os.path.dirname(__file__), 'liqi_proto/liqi.json'), 'r'))

    def init(self):
        self.msg_id = 1
        self.res_type.clear()

    def parse(self, flow_msg) -> dict:
        if isinstance(flow_msg, bytes):
            buf = flow_msg
        else:
            buf = flow_msg.content
        result = dict()
        try:
            msg_type = MsgType(buf[0])
            if msg_type == MsgType.Notify:
                msg_block = from_protobuf(buf[1:])
                method_name = msg_block[0]['data'].decode()
                _, lq, message_name = method_name.split('.')
                try:
                    liqi_pb2_notify = getattr(pb, message_name)
                except AttributeError:
                    logger.warning(f'Unknown Notify Message: {message_name}')
                    return result
                proto_obj = liqi_pb2_notify.FromString(msg_block[1]['data'])
                dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                if 'data' in dict_obj:
                    B = base64.b64decode(dict_obj['data'])
                    action_proto_obj = getattr(pb, dict_obj['name']).FromString(decode(B))
                    action_dict_obj = MessageToDict(action_proto_obj, always_print_fields_with_no_presence=True)
                    dict_obj['data'] = action_dict_obj
                msg_id = -1
            else:
                msg_id = struct.unpack('<H', buf[1:3])[0]
                msg_block = from_protobuf(buf[3:])
                if msg_type == MsgType.Req:
                    assert (msg_id < 1 << 16)
                    assert (len(msg_block) == 2)
                    assert (msg_id not in self.res_type)
                    method_name = msg_block[0]['data'].decode()
                    _, lq, service, rpc = method_name.split('.')
                    proto_domain = self.jsonProto['nested'][lq]['nested'][service]['methods'][rpc]
                    try:
                        liqi_pb2_req = getattr(pb, proto_domain['requestType'])
                    except AttributeError:
                        logger.warning(f'Unknown Request Message: {proto_domain["requestType"]}')
                        self.res_type[msg_id] = (method_name, None)
                        return result
                    proto_obj = liqi_pb2_req.FromString(msg_block[1]['data'])
                    dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                    self.res_type[msg_id] = (method_name, getattr(
                        pb, proto_domain['responseType']))
                    self.msg_id = msg_id
                elif msg_type == MsgType.Res:
                    assert (len(msg_block[0]['data']) == 0)
                    assert (msg_id in self.res_type)
                    method_name, liqi_pb2_res = self.res_type.pop(msg_id)
                    if liqi_pb2_res is None:
                        logger.warning(f'Unknown Response Message: {method_name}')
                        return result
                    proto_obj = liqi_pb2_res.FromString(msg_block[1]['data'])
                    dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                else:
                    logger.warning(f'unknow msg: {buf}')
                    return result
            result = {'id': msg_id, 'type': msg_type,
                      'method': method_name, 'data': dict_obj}
            self.tot += 1
        except Exception as e:
            logger.warning(
                f'{str(e)} unknow msg: {buf} at {e.__traceback__.tb_lineno}, msg_id: {msg_id}, res_type: {self.res_type}')
            return result
        return result

    def parse_sync_game(self, sync_game):
        assert sync_game['method'] == '.lq.FastTest.syncGame' or sync_game['method'] == '.lq.FastTest.enterGame'
        msgs = []
        if 'gameRestore' in sync_game['data']:
            for action in sync_game['data']['gameRestore']['actions']:
                msgs.append(self.parse_sync_game_actions(action))
        return msgs

    def parse_sync_game_actions(self, dict_obj):
        dict_obj['data'] = MessageToDict(getattr(pb, dict_obj['name']).FromString(base64.b64decode(dict_obj['data'])),
                                         always_print_fields_with_no_presence=True)
        msg_id = -1
        result = {'id': msg_id, 'type': MsgType.Notify,
                  'method': '.lq.ActionPrototype', 'data': dict_obj}
        return result

    def compose(self, data, msg_id=-1):
        if data['type'] == MsgType.Notify:
            return self.compose_notify(data)
        msg_block = [
            {'id': 1, 'type': 'string', 'data': b'.lq.FastTest.authGame'},
            {'id': 2, 'type': 'string', 'data': b'protobuf_bytes'}
        ]
        _, lq, service, rpc = data['method'].split('.')
        proto_domain = self.jsonProto['nested'][lq]['nested'][service]['methods'][rpc]
        if data['type'] == MsgType.Req:
            message = ParseDict(data['data'], getattr(pb, proto_domain['requestType'])())
        elif data['type'] == MsgType.Res:
            message = ParseDict(data['data'], getattr(pb, proto_domain['responseType'])())
        msg_block[0]['data'] = data['method'].encode()
        msg_block[1]['data'] = message.SerializeToString()
        if msg_id == -1:
            compose_id = (self.msg_id - 8) % 256
        else:
            compose_id = msg_id
        if data['type'] == MsgType.Req:
            composed = b'\x02' + struct.pack('<H', compose_id) + to_protobuf(msg_block)
            self.parse(composed)
            return composed
        elif data['type'] == MsgType.Res:
            composed = b'\x03' + struct.pack('<H', compose_id) + to_protobuf(msg_block)
            return composed
        else:
            raise

    def compose_notify(self, data):
        msg_block = [
            {'id': 1, 'type': 'string', 'data': b'.lq.FastTest.authGame'},
            {'id': 2, 'type': 'string', 'data': b'protobuf_bytes'}
        ]

        _, lq, message_name = data['method'].split('.')

        msg_block[0]['data'] = data['method'].encode()
        msg_block[1]['data'] = ...

        if 'data' in data['data']:
            action_dict_obj = data['data']['data']
            action_proto_obj = ParseDict(action_dict_obj, getattr(pb, data['data']['name'])())
            action_proto_obj = action_proto_obj.SerializeToString()
            B = encode(action_proto_obj)
            data['data']['data'] = base64.b64encode(B)

        message = ParseDict(data['data'], getattr(pb, message_name)())
        msg_block[1]['data'] = message.SerializeToString()
        composed = b'\x01' + to_protobuf(msg_block)
        return composed


def to_varint(x: int) -> bytes:
    data = 0
    base = 0
    length = 0
    if x == 0:
        return b'\x00'
    while x > 0:
        length += 1
        data += (x & 127) << base
        x >>= 7
        if x > 0:
            data += 1 << (base + 7)
        base += 8
    return data.to_bytes(length, 'little')


def parse_varint(buf, p):
    # parse a varint from protobuf
    data = 0
    base = 0
    while p < len(buf):
        data += (buf[p] & 127) << base
        base += 7
        p += 1
        if buf[p - 1] >> 7 == 0:
            break
    return data, p


def from_protobuf(buf) -> list[dict]:
    # """
    # dump the struct of protobuf
    # buf: protobuf bytes
    # """
    p = 0
    result = []
    while p < len(buf):
        block_begin = p
        block_type = (buf[p] & 7)
        block_id = buf[p] >> 3
        p += 1
        if block_type == 0:
            # varint
            block_type = 'varint'
            data, p = parse_varint(buf, p)
        elif block_type == 2:
            # string
            block_type = 'string'
            s_len, p = parse_varint(buf, p)
            data = buf[p:p + s_len]
            p += s_len
        else:
            raise Exception('unknow type:', block_type, ' at', p)
        result.append({'id': block_id, 'type': block_type,
                       'data': data, 'begin': block_begin})
    return result


def to_protobuf(data: list[dict]) -> bytes:
    # """
    # Inverse operation of 'fromProtobuf'
    # """
    result = b''
    for d in data:
        if d['type'] == 'varint':
            result += ((d['id'] << 3) + 0).to_bytes(length=1, byteorder='little')
            result += to_varint(d['data'])
        elif d['type'] == 'string':
            result += ((d['id'] << 3) + 2).to_bytes(length=1, byteorder='little')
            result += to_varint(len(d['data']))
            result += d['data']
        else:
            raise NotImplementedError
    return result
