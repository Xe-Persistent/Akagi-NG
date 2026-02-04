import base64
import json
import struct
import time
from enum import IntEnum

from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import message_factory as _message_factory
from google.protobuf.json_format import MessageToDict

from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.consts import LiqiProtocolConstants
from akagi_ng.core.paths import get_assets_dir


class MsgType(IntEnum):
    Notify = 1
    Req = 2
    Res = 3


keys = [0x84, 0x5E, 0x4E, 0x42, 0x39, 0xA2, 0x1F, 0x60, 0x1C]


class LiqiProto:
    def __init__(self):
        self.msg_id = 1
        self.parsed_msg_count = 0
        self.last_heartbeat_time = 0.0
        self.res_type = {}

        # Dynamic Protobuf setup
        self.pool = _descriptor_pool.DescriptorPool()

        with open(get_assets_dir() / "liqi.json", encoding="utf-8") as f:
            self.jsonProto = json.load(f)

        self._build_descriptors()

    def _build_descriptors(self) -> None:
        """Build FileDescriptorProto from liqi.json and add to pool."""
        fd = _descriptor_pb2.FileDescriptorProto()
        fd.name = "protocol.proto"
        fd.package = "lq"
        fd.syntax = "proto3"

        lq_data = self.jsonProto["nested"]["lq"]["nested"]

        # Registry: full_name -> is_enum
        type_info: dict[str, bool] = {}
        self._register_types(lq_data, ".lq", type_info)

        # Root build
        for name, obj in lq_data.items():
            self._build_type(fd, name, obj, type_info)

        self.pool.Add(fd)

    def _register_types(self, nested_data: dict, prefix: str, type_info: dict[str, bool]) -> None:
        for name, obj in nested_data.items():
            full_name = f"{prefix}.{name}"
            if "fields" in obj:
                type_info[full_name] = False
                if "nested" in obj:
                    self._register_types(obj["nested"], full_name, type_info)
            elif "values" in obj:
                type_info[full_name] = True

    def _build_type(self, parent_proto: object, name: str, obj: dict, type_info: dict[str, bool]) -> None:
        if "fields" in obj:
            self._build_message(parent_proto, name, obj, type_info)
        elif "values" in obj:
            self._build_enum(parent_proto, name, obj)

    def _build_message(self, parent_proto: object, name: str, obj: dict, type_info: dict[str, bool]) -> None:
        if hasattr(parent_proto, "nested_type"):
            msg_desc = parent_proto.nested_type.add()
        else:
            msg_desc = parent_proto.message_type.add()
        msg_desc.name = name

        for f_name, f_obj in obj["fields"].items():
            self._build_field(msg_desc, f_name, f_obj, type_info)

        if "nested" in obj:
            for n_name, n_obj in obj["nested"].items():
                self._build_type(msg_desc, n_name, n_obj, type_info)

    def _build_field(self, msg_desc: object, f_name: str, f_obj: dict, type_info: dict[str, bool]) -> None:
        field = msg_desc.field.add()
        field.name = f_name
        field.number = f_obj["id"]
        field.label = (
            _descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED
            if f_obj.get("rule") == "repeated"
            else _descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
        )

        type_map = {
            "double": _descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE,
            "float": _descriptor_pb2.FieldDescriptorProto.TYPE_FLOAT,
            "int64": _descriptor_pb2.FieldDescriptorProto.TYPE_INT64,
            "uint64": _descriptor_pb2.FieldDescriptorProto.TYPE_UINT64,
            "int32": _descriptor_pb2.FieldDescriptorProto.TYPE_INT32,
            "uint32": _descriptor_pb2.FieldDescriptorProto.TYPE_UINT32,
            "bool": _descriptor_pb2.FieldDescriptorProto.TYPE_BOOL,
            "string": _descriptor_pb2.FieldDescriptorProto.TYPE_STRING,
            "bytes": _descriptor_pb2.FieldDescriptorProto.TYPE_BYTES,
        }

        p_type = f_obj["type"]
        if p_type in type_map:
            field.type = type_map[p_type]
        else:
            resolved = self._resolve_type_name(p_type, type_info)
            field.type_name = resolved
            field.type = (
                _descriptor_pb2.FieldDescriptorProto.TYPE_ENUM
                if type_info.get(resolved, False)
                else _descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE
            )

    def _resolve_type_name(self, p_type: str, type_info: dict[str, bool]) -> str:
        resolved = f".lq.{p_type}"
        if resolved in type_info:
            return resolved

        suffix = f".{p_type}"
        for k in type_info:
            if k.endswith(suffix):
                return k
        return resolved

    def _build_enum(self, parent_proto: object, name: str, obj: dict) -> None:
        enum_desc = parent_proto.enum_type.add()
        enum_desc.name = name
        for v_name, v_id in obj["values"].items():
            val = enum_desc.value.add()
            val.name = v_name
            val.number = v_id

    def get_message_class(self, name: str) -> type | None:
        """Find specialized message class by name (e.g. 'ActionNewRound')."""
        try:
            desc = self.pool.FindMessageTypeByName(f"lq.{name}")
            return _message_factory.GetMessageClass(desc)
        except KeyError:
            logger.warning(f"Message type {name} not found in protocol")
            return None

    def init(self):
        self.msg_id = 1
        self.res_type.clear()

    def _parse_notify(self, msg_block: list[dict]) -> tuple[str, dict]:
        """解析 Notify 类型消息"""
        method_name = msg_block[0]["data"].decode()
        bits = method_name.split(".")
        message_name = bits[-1]

        msg_cls = self.get_message_class(message_name)
        if not msg_cls:
            raise AttributeError(f"Unknown Notify Message: {message_name}")

        proto_obj = msg_cls.FromString(msg_block[1]["data"])
        dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)

        # Handle Wrapper/ActionPrototype nested data
        if "data" in dict_obj and "name" in dict_obj:
            inner_name = dict_obj["name"]
            inner_cls = self.get_message_class(inner_name)
            if inner_cls:
                decoded_binary_data = base64.b64decode(dict_obj["data"])
                action_proto_obj = inner_cls.FromString(decode(decoded_binary_data))
                dict_obj["data"] = MessageToDict(action_proto_obj, always_print_fields_with_no_presence=True)
        return method_name, dict_obj

    def _parse_request(self, msg_id: int, msg_block: list[dict]) -> tuple[str, dict]:
        """解析 Request 类型消息"""
        assert msg_id < 1 << 16
        assert len(msg_block) == LiqiProtocolConstants.MSG_BLOCK_SIZE
        assert msg_id not in self.res_type

        method_name = msg_block[0]["data"].decode()
        parts = method_name.split(".")
        lq = parts[1]
        service = parts[2]
        rpc = parts[3]

        if service == "Route" and rpc == "heartbeat":
            self.last_heartbeat_time = time.time()

        proto_domain = self.jsonProto["nested"][lq]["nested"][service]["methods"][rpc]
        req_cls = self.get_message_class(proto_domain["requestType"])
        if not req_cls:
            logger.warning(f"Unknown Request Message: {proto_domain['requestType']}")
            self.res_type[msg_id] = (method_name, None)
            raise AttributeError(f"Unknown Request Message: {proto_domain['requestType']}")

        proto_obj = req_cls.FromString(msg_block[1]["data"])
        dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)

        res_cls = self.get_message_class(proto_domain["responseType"])
        self.res_type[msg_id] = (method_name, res_cls)
        self.msg_id = msg_id
        return method_name, dict_obj

    def _parse_response(self, msg_id: int, msg_block: list[dict]) -> tuple[str, dict]:
        """解析 Response 类型消息"""
        assert len(msg_block[0]["data"]) == LiqiProtocolConstants.EMPTY_DATA_LEN
        assert msg_id in self.res_type

        method_name, res_cls = self.res_type.pop(msg_id)
        if res_cls is None:
            logger.warning(f"Unknown Response Message: {method_name}")
            raise AttributeError(f"Unknown Response Message: {method_name}")

        proto_obj = res_cls.FromString(msg_block[1]["data"])
        dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
        return method_name, dict_obj

    def parse(self, flow_msg: bytes | object) -> dict:
        buf: bytes = flow_msg if isinstance(flow_msg, bytes) else flow_msg.content
        result = {}
        msg_id = -1
        try:
            msg_type = MsgType(buf[0])
            if msg_type == MsgType.Notify:
                msg_block = from_protobuf(buf[1:])
                method_name, dict_obj = self._parse_notify(msg_block)
                msg_id = -1
            else:
                msg_id = struct.unpack("<H", buf[1:3])[0]
                msg_block = from_protobuf(buf[3:])
                if msg_type == MsgType.Req:
                    self.msg_id = msg_id
                    method_name, dict_obj = self._parse_request(msg_id, msg_block)
                elif msg_type == MsgType.Res:
                    method_name, dict_obj = self._parse_response(msg_id, msg_block)
                else:
                    logger.warning(f"unknown msg type: {buf[0]}")
                    return result
            result = {"id": msg_id, "type": msg_type, "method": method_name, "data": dict_obj}
            self.parsed_msg_count += 1
        except Exception as e:
            logger.warning(f"Decode error: {e!s} (msg_id: {msg_id}, type: {buf[0] if buf else 'empty'})")
            return result
        return result


def decode(data: bytes) -> bytes:
    data = bytearray(data)
    for i in range(len(data)):
        u = (23 ^ len(data)) + 5 * i + keys[i % len(keys)] & 255
        data[i] ^= u
    return bytes(data)


def parse_varint(buf: bytes, p: int) -> tuple[int, int]:
    data = 0
    base = 0
    while p < len(buf):
        data += (buf[p] & 127) << base
        base += 7
        p += 1
        if buf[p - 1] >> 7 == 0:
            break
    return data, p


def from_protobuf(buf: bytes) -> list[dict]:
    p = 0
    result = []
    while p < len(buf):
        block_begin = p
        block_type = buf[p] & 7
        block_id = buf[p] >> 3
        p += 1
        if block_type == LiqiProtocolConstants.BLOCK_TYPE_VARINT:
            block_type = "varint"
            data, p = parse_varint(buf, p)
        elif block_type == LiqiProtocolConstants.BLOCK_TYPE_STRING:
            block_type = "string"
            s_len, p = parse_varint(buf, p)
            data = buf[p : p + s_len]
            p += s_len
        else:
            raise Exception(f"unknown pb block type: {block_type}")
        result.append({"id": block_id, "type": block_type, "data": data, "begin": block_begin})
    return result
