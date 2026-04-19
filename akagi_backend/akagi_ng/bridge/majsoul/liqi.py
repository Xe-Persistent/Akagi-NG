import json
import struct
import time
from enum import IntEnum

from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import message as _message
from google.protobuf import message_factory as _message_factory
from google.protobuf.json_format import MessageToDict, ParseDict

from akagi_ng.bridge.logger import logger
from akagi_ng.bridge.majsoul.consts import LiqiProtocolConstants
from akagi_ng.core.paths import get_assets_dir
from akagi_ng.schema.protocols import MessageWithContent


class MsgType(IntEnum):
    Notify = 1
    Req = 2
    Res = 3


RPC_METHOD_PARTS = 4


keys = [0x84, 0x5E, 0x4E, 0x42, 0x39, 0xA2, 0x1F, 0x60, 0x1C]


class LiqiProto:
    def __init__(self):
        self.msg_id = 1
        self.parsed_msg_count = 0
        self.last_heartbeat_time = 0.0
        self.res_type = {}
        self._msg_cls_cache: dict[str, type[_message.Message]] = {}

        # 动态构建 Protobuf 描述池
        self.pool = _descriptor_pool.DescriptorPool()

        self.jsonProto = json.loads((get_assets_dir() / "liqi.json").read_text(encoding="utf-8"))

        self._build_descriptors()

    def _build_descriptors(self):
        """根据 liqi.json 构建 FileDescriptorProto 并注册到描述池。"""
        fd = _descriptor_pb2.FileDescriptorProto()
        fd.name = "protocol.proto"
        fd.package = "lq"
        fd.syntax = "proto3"

        lq_data = self.jsonProto["nested"]["lq"]["nested"]

        # 类型注册表：full_name -> 是否为枚举
        type_info: dict[str, bool] = {}
        self._register_types(lq_data, ".lq", type_info)

        # 构建根级类型
        for name, obj in lq_data.items():
            self._build_type(fd, name, obj, type_info)

        self.pool.Add(fd)

    def _register_types(self, nested_data: dict, prefix: str, type_info: dict[str, bool]):
        for name, obj in nested_data.items():
            full_name = f"{prefix}.{name}"
            if "fields" in obj:
                type_info[full_name] = False
                if "nested" in obj:
                    self._register_types(obj["nested"], full_name, type_info)
            elif "values" in obj:
                type_info[full_name] = True

    def _build_type(
        self,
        parent_proto: _descriptor_pb2.FileDescriptorProto | _descriptor_pb2.DescriptorProto,
        name: str,
        obj: dict,
        type_info: dict[str, bool],
    ):
        if "fields" in obj:
            self._build_message(parent_proto, name, obj, type_info)
        elif "values" in obj:
            self._build_enum(parent_proto, name, obj)

    def _build_message(
        self,
        parent_proto: _descriptor_pb2.FileDescriptorProto | _descriptor_pb2.DescriptorProto,
        name: str,
        obj: dict,
        type_info: dict[str, bool],
    ):
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

    def _build_field(
        self, msg_desc: _descriptor_pb2.DescriptorProto, f_name: str, f_obj: dict, type_info: dict[str, bool]
    ):
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

    def _build_enum(
        self, parent_proto: _descriptor_pb2.FileDescriptorProto | _descriptor_pb2.DescriptorProto, name: str, obj: dict
    ):
        enum_desc = parent_proto.enum_type.add()
        enum_desc.name = name
        for v_name, v_id in obj["values"].items():
            val = enum_desc.value.add()
            val.name = v_name
            val.number = v_id

    def get_message_class(self, name: str) -> type[_message.Message] | None:
        """按消息名查找动态生成的 Protobuf 消息类。"""
        if name in self._msg_cls_cache:
            return self._msg_cls_cache[name]
        try:
            desc = self.pool.FindMessageTypeByName(f"lq.{name}")
            cls = _message_factory.GetMessageClass(desc)
            self._msg_cls_cache[name] = cls
            return cls
        except KeyError:
            logger.warning(f"Message type {name} not found in protocol")
            return None

    def get_rpc_message_classes(
        self, method_name: str
    ) -> tuple[type[_message.Message] | None, type[_message.Message] | None]:
        """Return request/response protobuf classes for an RPC method."""
        parts = method_name.split(".")
        if len(parts) < RPC_METHOD_PARTS:
            return None, None

        lq, service, rpc = parts[1:4]
        try:
            rpc_info = self.jsonProto["nested"][lq]["nested"][service]["methods"][rpc]
        except KeyError:
            logger.warning(f"RPC method {method_name} not found in protocol")
            return None, None

        req_cls = self.get_message_class(rpc_info["requestType"])
        res_cls = self.get_message_class(rpc_info["responseType"])
        return req_cls, res_cls

    def set_pending_response(self, msg_id: int, method_name: str) -> None:
        """Override the response type associated with a pending request."""
        _, res_cls = self.get_rpc_message_classes(method_name)
        self.res_type[msg_id] = (method_name, res_cls)

    def drop_pending_response(self, msg_id: int) -> None:
        self.res_type.pop(msg_id, None)

    def build_message(self, message_name: str, data: dict | None) -> bytes:
        """Serialize a protobuf message from a dict using dynamic descriptors."""
        msg_cls = self.get_message_class(message_name)
        if not msg_cls:
            raise AttributeError(f"Unknown Message: {message_name}")

        proto_obj = msg_cls()
        ParseDict(data or {}, proto_obj, ignore_unknown_fields=False)
        return proto_obj.SerializeToString()

    def build_packet(self, msg_type: MsgType, method_name: str, data: dict | None, msg_id: int = -1) -> bytes:
        """Serialize a Liqi packet back into its websocket binary form."""
        if msg_type == MsgType.Notify:
            message_name = method_name.split(".")[-1]
        else:
            req_cls, res_cls = self.get_rpc_message_classes(method_name)
            target_cls = req_cls if msg_type == MsgType.Req else res_cls
            if not target_cls:
                raise AttributeError(f"Unknown RPC message class for {method_name}")
            message_name = target_cls.DESCRIPTOR.name
        payload = self.build_message(message_name, data)

        if msg_type == MsgType.Notify:
            blocks = [
                {"id": 1, "type": "string", "data": method_name.encode()},
                {"id": 2, "type": "string", "data": payload},
            ]
            return bytes([int(msg_type)]) + to_protobuf(blocks)

        if msg_type == MsgType.Req:
            blocks = [
                {"id": 1, "type": "string", "data": method_name.encode()},
                {"id": 2, "type": "string", "data": payload},
            ]
            return bytes([int(msg_type)]) + struct.pack("<H", msg_id) + to_protobuf(blocks)

        if msg_type == MsgType.Res:
            blocks = [
                {"id": 1, "type": "string", "data": b""},
                {"id": 2, "type": "string", "data": payload},
            ]
            return bytes([int(msg_type)]) + struct.pack("<H", msg_id) + to_protobuf(blocks)

        raise ValueError(f"Unsupported message type: {msg_type}")

    def init(self):
        self.msg_id = 1
        self.res_type.clear()

    def _parse_notify(self, msg_block: list[dict]) -> tuple[str, dict]:
        """解析 Notify 类型消息"""
        method_name = msg_block[0]["data"].decode()
        message_name = method_name.split(".")[-1]

        msg_cls = self.get_message_class(message_name)
        if not msg_cls:
            raise AttributeError(f"Unknown Notify Message: {message_name}")

        proto_obj = msg_cls.FromString(msg_block[1]["data"])

        # 如果是 ActionPrototype 包装器，避免对外部包装器执行昂贵的实例 Dict 转换。
        if message_name == "ActionPrototype" or (hasattr(proto_obj, "name") and hasattr(proto_obj, "data")):
            inner_name = proto_obj.name
            inner_dict = self.parse_wrapper(inner_name, proto_obj.data, use_xor=True)
            if inner_dict is not None:
                res_dict = {"name": inner_name, "data": inner_dict}
                if hasattr(proto_obj, "step"):
                    res_dict["step"] = proto_obj.step
                return method_name, res_dict

        # 通用路径
        dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
        return method_name, dict_obj

    def parse_wrapper(self, name: str, data: bytes, use_xor: bool = True) -> dict | None:
        """解析包装器中的嵌套数据。"""
        cls = self.get_message_class(name)
        if not cls:
            return None

        raw_data = decode(data) if use_xor else data
        proto = cls.FromString(raw_data)
        return MessageToDict(proto, always_print_fields_with_no_presence=True)

    def _parse_request(self, msg_id: int, msg_block: list[dict]) -> tuple[str, dict]:
        """解析 Request 类型消息"""
        if msg_id >= 1 << 16:
            raise ValueError(f"msg_id {msg_id} exceeds max value")
        if len(msg_block) != LiqiProtocolConstants.MSG_BLOCK_SIZE:
            raise ValueError(
                f"Invalid msg_block size: {len(msg_block)}, expected {LiqiProtocolConstants.MSG_BLOCK_SIZE}"
            )
        if msg_id in self.res_type:
            logger.debug(f"Duplicate msg_id {msg_id}, overwriting previous request")
            del self.res_type[msg_id]

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
        if len(msg_block[0]["data"]) != LiqiProtocolConstants.EMPTY_DATA_LEN:
            raise ValueError(f"Response first block not empty, got {len(msg_block[0]['data'])} bytes")
        if msg_id not in self.res_type:
            raise ValueError(f"Response msg_id {msg_id} not found in pending requests")

        method_name, res_cls = self.res_type.pop(msg_id)
        if res_cls is None:
            logger.warning(f"Unknown Response Message: {method_name}")
            raise AttributeError(f"Unknown Response Message: {method_name}")

        proto_obj = res_cls.FromString(msg_block[1]["data"])
        dict_obj = MessageToDict(proto_obj, always_print_fields_with_no_presence=True)
        return method_name, dict_obj

    def parse(self, flow_msg: bytes | MessageWithContent) -> dict:
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
            logger.debug(
                f"Decode skipped: {type(e).__name__}: {e!s} (msg_id: {msg_id}, type: {buf[0] if buf else 'empty'})"
            )
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
            raise ValueError(f"unknown pb block type: {block_type}")
        result.append({"id": block_id, "type": block_type, "data": data, "begin": block_begin})
    return result


def encode_varint(value: int) -> bytes:
    """Encode an integer using protobuf varint format."""
    if value < 0:
        raise ValueError("varint only supports non-negative integers")

    out = bytearray()
    while True:
        to_write = value & 0x7F
        value >>= 7
        if value:
            out.append(to_write | 0x80)
        else:
            out.append(to_write)
            break
    return bytes(out)


def to_protobuf(blocks: list[dict]) -> bytes:
    """Serialize the simplified block structure used by Liqi packets."""
    out = bytearray()
    type_map = {"varint": LiqiProtocolConstants.BLOCK_TYPE_VARINT, "string": LiqiProtocolConstants.BLOCK_TYPE_STRING}

    for block in blocks:
        field_id = int(block["id"])
        block_type = block["type"]
        wire_type = type_map[block_type]
        out.append((field_id << 3) | wire_type)

        if block_type == "varint":
            out.extend(encode_varint(int(block["data"])))
        elif block_type == "string":
            data = block["data"]
            out.extend(encode_varint(len(data)))
            out.extend(data)
        else:
            raise ValueError(f"unknown pb block type: {block_type}")

    return bytes(out)
