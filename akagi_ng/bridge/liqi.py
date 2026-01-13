import base64
import json
import struct
import time
from enum import Enum

from google.protobuf.json_format import MessageToDict

from akagi_ng.bridge import liqi_pb2 as pb
from akagi_ng.bridge.logger import logger
from akagi_ng.core.paths import get_assets_dir


class MsgType(Enum):
    Notify = 1
    Req = 2
    Res = 3


keys = [0x84, 0x5E, 0x4E, 0x42, 0x39, 0xA2, 0x1F, 0x60, 0x1C]


def parse_sync_game_actions(dict_obj):
    dict_obj["data"] = MessageToDict(
        getattr(pb, dict_obj["name"]).FromString(base64.b64decode(dict_obj["data"])),
        always_print_fields_with_no_presence=True,
    )
    msg_id = -1
    result = {"id": msg_id, "type": MsgType.Notify, "method": ".lq.ActionPrototype", "data": dict_obj}
    return result


def parse_sync_game(sync_game):
    assert sync_game["method"] == ".lq.FastTest.syncGame" or sync_game["method"] == ".lq.FastTest.enterGame"
    msgs = []
    if "gameRestore" in sync_game["data"]:
        for action in sync_game["data"]["gameRestore"]["actions"]:
            msgs.append(parse_sync_game_actions(action))
    return msgs


class LiqiProto:
    def __init__(self):
        self.msg_id = 1
        self.parsed_msg_count = 0
        self.last_heartbeat_time = 0.0
        self.res_type = {}
        with open(get_assets_dir() / "liqi.json", encoding="utf-8") as f:
            self.jsonProto = json.load(f)

    def init(self):
        self.msg_id = 1
        self.res_type.clear()

    def parse(self, flow_msg) -> dict:
        buf: bytes = flow_msg if isinstance(flow_msg, bytes) else flow_msg.content
        result = {}
        msg_id = -1
        try:
            msg_type = MsgType(buf[0])
            if msg_type == MsgType.Notify:
                msg_block = from_protobuf(buf[1:])
                method_name = msg_block[0]["data"].decode()
                _, lq, message_name = method_name.split(".")
                try:
                    liqi_pb2_notify = getattr(pb, message_name)
                except AttributeError:
                    logger.warning(f"Unknown Notify Message: {message_name}")
                    return result
                proto_obj = liqi_pb2_notify.FromString(msg_block[1]["data"])
                dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                if "data" in dict_obj:
                    decoded_binary_data = base64.b64decode(dict_obj["data"])
                    action_proto_obj = getattr(pb, dict_obj["name"]).FromString(decode(decoded_binary_data))
                    action_dict_obj = MessageToDict(action_proto_obj, always_print_fields_with_no_presence=True)
                    dict_obj["data"] = action_dict_obj
                msg_id = -1
            else:
                msg_id = struct.unpack("<H", buf[1:3])[0]
                msg_block = from_protobuf(buf[3:])
                if msg_type == MsgType.Req:
                    assert msg_id < 1 << 16
                    assert len(msg_block) == 2
                    assert msg_id not in self.res_type
                    method_name = msg_block[0]["data"].decode()
                    _, lq, service, rpc = method_name.split(".")
                    if service == "Route" and rpc == "heartbeat":
                        self.last_heartbeat_time = time.time()
                    proto_domain = self.jsonProto["nested"][lq]["nested"][service]["methods"][rpc]
                    try:
                        liqi_pb2_req = getattr(pb, proto_domain["requestType"])
                    except AttributeError:
                        logger.warning(f"Unknown Request Message: {proto_domain['requestType']}")
                        self.res_type[msg_id] = (method_name, None)
                        return result
                    proto_obj = liqi_pb2_req.FromString(msg_block[1]["data"])
                    dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                    self.res_type[msg_id] = (method_name, getattr(pb, proto_domain["responseType"]))
                    self.msg_id = msg_id
                elif msg_type == MsgType.Res:
                    assert len(msg_block[0]["data"]) == 0
                    assert msg_id in self.res_type
                    method_name, liqi_pb2_res = self.res_type.pop(msg_id)
                    if liqi_pb2_res is None:
                        logger.warning(f"Unknown Response Message: {method_name}")
                        return result
                    proto_obj = liqi_pb2_res.FromString(msg_block[1]["data"])
                    dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
                else:
                    logger.warning(f"unknow msg: {buf}")
                    return result
            result = {"id": msg_id, "type": msg_type, "method": method_name, "data": dict_obj}
            self.parsed_msg_count += 1
        except Exception as e:
            logger.warning(
                f"{e!s} unknow msg: {buf} at {e.__traceback__.tb_lineno}, msg_id: {msg_id}, res_type: {self.res_type}"
            )
            return result
        return result


def decode(data: bytes):
    data = bytearray(data)
    for i in range(len(data)):
        u = (23 ^ len(data)) + 5 * i + keys[i % len(keys)] & 255
        data[i] ^= u
    return bytes(data)


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
    """
    dump the struct of protobuf
    buf: protobuf bytes
    """
    p = 0
    result = []
    while p < len(buf):
        block_begin = p
        block_type = buf[p] & 7
        block_id = buf[p] >> 3
        p += 1
        if block_type == 0:
            # varint
            block_type = "varint"
            data, p = parse_varint(buf, p)
        elif block_type == 2:
            # string
            block_type = "string"
            s_len, p = parse_varint(buf, p)
            data = buf[p : p + s_len]
            p += s_len
        else:
            raise Exception("unknow type:", block_type, " at", p)
        result.append({"id": block_id, "type": block_type, "data": data, "begin": block_begin})
    return result
