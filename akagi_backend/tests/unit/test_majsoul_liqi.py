"""
测试模块：akagi_backend/tests/unit/test_majsoul_liqi.py

描述：针对雀魂 (Majsoul) Liqi 协议解析器的单元测试。
主要测试点：
- LiqiProto 对 Request、Response 和 Notify 三种消息类型的二进制解析逻辑。
- Protobuf Varint 编码解析及 XOR 解码逻辑。
- 嵌套消息 (ActionPrototype 在 Wrapper 中) 的自动提取与解析。
- 心跳包处理及消息类找不到时的容错机制。
"""

import struct
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType, from_protobuf


@pytest.fixture
def proto():
    # 模拟 __init__ 中的文件读取和描述符构建
    with (
        patch("akagi_ng.bridge.majsoul.liqi.open"),
        patch("json.load", return_value={"nested": {"lq": {"nested": {}}}}),
        patch.object(LiqiProto, "_build_descriptors"),
    ):
        p = LiqiProto()
        p.jsonProto = {"nested": {"lq": {"nested": {}}}}
        return p


def test_liqi_proto_empty_payload():
    parser = LiqiProto()
    assert parser.parse(b"") == {}


def test_liqi_proto_parse_request(proto) -> None:
    # 请求块需包含方法名和数据
    block = [{"data": b".lq.Lobby.oauth2Auth"}, {"data": b"data"}]

    # 模拟 jsonProto 中的方法映射
    proto.jsonProto = {
        "nested": {
            "lq": {"nested": {"Lobby": {"methods": {"oauth2Auth": {"requestType": "Req", "responseType": "Res"}}}}}
        }
    }

    with patch.object(proto, "get_message_class") as mock_get_cls:
        mock_cls = MagicMock()
        mock_get_cls.return_value = mock_cls

        with patch("akagi_ng.bridge.majsoul.liqi.MessageToDict", return_value={"key": "val"}):
            method, dict_obj = proto._parse_request(123, block)
            assert method == ".lq.Lobby.oauth2Auth"
            assert dict_obj == {"key": "val"}


def test_liqi_proto_parse_response(proto) -> None:
    # 响应块：第一个为空，第二个为数据
    proto.res_type[123] = (".lq.Lobby.oauth2Auth", MagicMock())  # (method, class)
    block = [{"data": b""}, {"data": b"data"}]

    with patch("akagi_ng.bridge.majsoul.liqi.MessageToDict", return_value={"res": "ok"}):
        method, dict_obj = proto._parse_response(123, block)
        assert method == ".lq.Lobby.oauth2Auth"
        assert dict_obj == {"res": "ok"}


def test_liqi_proto_get_message_class_failure(proto) -> None:
    # 覆盖异常路径
    proto.pool = MagicMock()
    proto.pool.FindMessageTypeByName.side_effect = KeyError("Not found")
    assert proto.get_message_class("Unknown") is None


def test_liqi_proto_full_parse_flow(proto) -> None:
    header = bytes([2]) + struct.pack("<H", 123)
    data = header + b"payload"

    with (
        patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[]),
        patch.object(proto, "_parse_request", return_value=(".lq.Method", {"k": "v"})),
    ):
        res = proto.parse(data)
        assert res["id"] == 123
        assert res["method"] == ".lq.Method"
        assert res["data"] == {"k": "v"}


def test_liqi_proto_parse_notify_with_nested_wrapper(proto):
    """测试 Notify 包含 Wrapper/ActionPrototype 嵌套 Base64 数据的解析"""
    # 模拟数据块
    block = [{"data": b".lq.Lobby.notifyAction"}, {"data": b"wrapped_proto_data"}]

    # 模拟 get_message_class
    with patch.object(proto, "get_message_class") as mock_get_cls:
        # Wrapper class
        mock_wrapper_cls = MagicMock()
        mock_wrapper_obj = MagicMock()
        mock_wrapper_cls.FromString.return_value = mock_wrapper_obj

        # Inner Action class
        mock_action_cls = MagicMock()
        mock_action_obj = MagicMock()
        mock_action_cls.FromString.return_value = mock_action_obj

        # Map requests
        mock_get_cls.side_effect = lambda name: {
            "notifyAction": mock_wrapper_cls,
            "ActionDiscardTile": mock_action_cls,
        }.get(name)

        # Mock MessageToDict for the inner action
        with (
            patch("akagi_ng.bridge.majsoul.liqi.MessageToDict") as mock_m2d,
            patch("akagi_ng.bridge.majsoul.liqi.decode", return_value=b"xor_decoded"),
        ):
            # Only one call: inner action
            mock_m2d.return_value = {"tile": "1m"}

            # 模拟 proto_obj 的属性
            proto_obj = MagicMock()
            proto_obj.name = "ActionDiscardTile"
            proto_obj.data = b"encoded_data"
            proto_obj.step = 1
            mock_wrapper_cls.FromString.return_value = proto_obj

            method, dict_obj = proto._parse_notify(block)

            assert method == ".lq.Lobby.notifyAction"
            assert dict_obj["data"] == {"tile": "1m"}
            assert dict_obj["name"] == "ActionDiscardTile"
            assert dict_obj["step"] == 1


def test_liqi_proto_varint_parsing():
    """测试 parse_varint 的各种边界情况"""
    from akagi_ng.bridge.majsoul.liqi import parse_varint

    # Single byte
    val, p = parse_varint(b"\x01", 0)
    assert val == 1
    assert p == 1

    # Multi-byte (128 = 0x80 0x01)
    val, p = parse_varint(b"\x80\x01", 0)
    assert val == 128
    assert p == 2

    # 300 (0xAC 0x02)
    val, p = parse_varint(b"\xac\x02", 0)
    assert val == 300
    assert p == 2


def test_liqi_proto_from_protobuf_error():
    """测试 from_protobuf 遇到未知 block type 的情况"""
    from akagi_ng.bridge.majsoul.liqi import from_protobuf

    with pytest.raises(Exception, match="unknown pb block type"):
        from_protobuf(b"\x07")  # Type 7 is unknown (only 0 and 2 supported)


def test_liqi_proto_xor_decode():
    """测试 Liqi 自定义的 XOR 解码逻辑"""
    from akagi_ng.bridge.majsoul.liqi import decode

    data = b"hello"
    decoded = decode(data)
    # 再解一次应该变回来是不可能的，因为长度参与了计算
    assert decoded != data
    # 验证两次结果一致性
    assert decode(data) == decoded


def test_liqi_proto_parse_heartbeat(proto):
    """测试心跳包解析并更新时间"""
    block = [{"data": b".lq.Route.heartbeat"}, {"data": b""}]
    proto.jsonProto = {
        "nested": {
            "lq": {"nested": {"Route": {"methods": {"heartbeat": {"requestType": "Req", "responseType": "Res"}}}}}
        }
    }

    with (
        patch.object(proto, "get_message_class", return_value=MagicMock()),
        patch("akagi_ng.bridge.majsoul.liqi.MessageToDict", return_value={}),
    ):
        old_time = proto.last_heartbeat_time
        proto._parse_request(1, block)
        assert proto.last_heartbeat_time > old_time


def test_liqi_proto_parse_notify_unknown_cls(proto):
    """测试 Notify 遇到未知消息类时抛出 AttributeError"""
    block = [{"data": b".lq.Unknown.msg"}, {"data": b""}]
    with (
        patch.object(proto, "get_message_class", return_value=None),
        pytest.raises(AttributeError, match="Unknown Notify Message"),
    ):
        proto._parse_notify(block)


def test_liqi_proto_parse_request_unknown_cls(proto):
    """测试 Request 遇到未知消息类"""
    block = [{"data": b".lq.Lobby.oauth2Auth"}, {"data": b""}]
    proto.jsonProto = {
        "nested": {
            "lq": {"nested": {"Lobby": {"methods": {"oauth2Auth": {"requestType": "Req", "responseType": "Res"}}}}}
        }
    }
    with (
        patch.object(proto, "get_message_class", return_value=None),
        pytest.raises(AttributeError, match="Unknown Request Message"),
    ):
        proto._parse_request(1, block)


def test_liqi_proto_parse_response_unknown_cls(proto):
    """测试 Response 遇到未知消息类"""
    proto.res_type[1] = ("method", None)
    block = [{"data": b""}, {"data": b""}]  # first block empty (0 length) for res
    with pytest.raises(AttributeError, match="Unknown Response Message"):
        proto._parse_response(1, block)


def test_liqi_proto_parse_notify_inner_unknown_cls(proto):
    """测试 Notify 嵌套数据时，内层消息类找不到的情况（应该跳过内层解析）"""
    block = [{"data": b".lq.Lobby.notifyAction"}, {"data": b"wrapped_proto_data"}]
    with (
        patch.object(proto, "get_message_class") as mock_get_cls,
        patch("akagi_ng.bridge.majsoul.liqi.MessageToDict") as mock_m2d,
    ):
        # 模拟 proto_obj 的属性，且 get_message_class 对内层返回 None
        proto_obj = MagicMock()
        proto_obj.name = "UnknownAction"
        proto_obj.data = b"raw_data"
        proto_obj.step = 10
        mock_get_cls.side_effect = lambda name: MagicMock() if name == "notifyAction" else None

        # 当内层找不到类时，parse_wrapper 返回 None
        # _parse_notify 会回退到通用的 MessageToDict(proto_obj) 路径
        mock_m2d.return_value = {"name": "UnknownAction", "data": "base64_string", "step": 10}

        method, dict_obj = proto._parse_notify(block)
        assert method == ".lq.Lobby.notifyAction"
        assert dict_obj["name"] == "UnknownAction"
        assert dict_obj["data"] == "base64_string"


def test_liqi_proto_full_parse_notify(proto):
    """测试 parse 方法处理 Notify 类型"""
    buf = bytes([1]) + b"dummy_pb"
    with (
        patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[]),
        patch.object(proto, "_parse_notify", return_value=("method", {"d": 1})),
    ):
        res = proto.parse(buf)
        assert res["type"] == 1
        assert res["method"] == "method"


def test_liqi_proto_full_parse_response(proto):
    """测试 parse 方法处理 Res 类型"""
    buf = bytes([3]) + struct.pack("<H", 123) + b"dummy_pb"
    with (
        patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[]),
        patch.object(proto, "_parse_response", return_value=("method", {"d": 1})),
    ):
        res = proto.parse(buf)
        assert res["type"] == 3
        assert res["id"] == 123


def test_liqi_proto_full_parse_error(proto):
    """测试 parse 方法处理异常（如数据截断）"""
    buf = bytes([3])  # Missing msg_id bytes
    res = proto.parse(buf)
    assert res == {}  # Exception caught and return empty dict


def test_liqi_proto_duplicate_msg_id(proto):
    """测试重复 msg_id 的容错处理（登录网络延迟检查场景）"""
    block = [{"data": b".lq.Lobby.oauth2Auth"}, {"data": b"data"}]
    proto.jsonProto = {
        "nested": {
            "lq": {"nested": {"Lobby": {"methods": {"oauth2Auth": {"requestType": "Req", "responseType": "Res"}}}}}
        }
    }

    # 先注册一个 msg_id=1 的旧请求
    proto.res_type[1] = (".lq.OldMethod", MagicMock())

    with (
        patch.object(proto, "get_message_class", return_value=MagicMock()),
        patch("akagi_ng.bridge.majsoul.liqi.MessageToDict", return_value={"key": "val"}),
    ):
        # 应该不会抛异常，而是覆盖旧记录
        method, dict_obj = proto._parse_request(1, block)
        assert method == ".lq.Lobby.oauth2Auth"
        assert dict_obj == {"key": "val"}


def test_liqi_proto_from_protobuf_varint_and_string():
    """覆盖 from_protobuf 中的 varint 和 string 分支"""
    from akagi_ng.bridge.majsoul.liqi import from_protobuf

    # Field 1 (type 0: varint): 1 -> 0x08 0x01
    # Field 2 (type 2: string): "a" -> 0x12 0x01 0x61
    buf = b"\x08\x01\x12\x01\x61"
    res = from_protobuf(buf)
    assert len(res) == 2
    assert res[0]["type"] == "varint"
    assert res[0]["data"] == 1
    assert res[1]["type"] == "string"
    assert res[1]["data"] == b"a"


# ===== 真实数据集成测试（原 test_liqi.py）=====


def test_liqi_proto_real_initialization():
    """验证 LiqiProto 能够成功加载真实的 liqi.json 并构建描述符"""
    lp = LiqiProto()
    assert lp.msg_id == 1
    assert lp.parsed_msg_count == 0

    types_to_check = [
        "ActionNewRound",
        "ActionDiscardTile",
        "ResCommon",
        "ActionPrototype",
        "Wrapper",
    ]
    for t in types_to_check:
        cls = lp.get_message_class(t)
        assert cls is not None, f"Failed to find message class: {t}"


def test_liqi_proto_init_method():
    """测试 init 方法重置状态"""
    lp = LiqiProto()
    lp.msg_id = 100
    lp.res_type[1] = ("test", None)

    lp.init()
    assert lp.msg_id == 1
    assert len(lp.res_type) == 0


def test_liqi_proto_get_rpc_message_classes_invalid_method(proto):
    req_cls, res_cls = proto.get_rpc_message_classes("invalid")
    assert req_cls is None
    assert res_cls is None


def test_liqi_proto_set_and_drop_pending_response(proto):
    req_cls = MagicMock()
    res_cls = MagicMock()
    with patch.object(proto, "get_rpc_message_classes", return_value=(req_cls, res_cls)):
        proto.set_pending_response(9, ".lq.Lobby.login")

    assert proto.res_type[9] == (".lq.Lobby.login", res_cls)
    proto.drop_pending_response(9)
    assert 9 not in proto.res_type


def test_liqi_proto_build_message_unknown_message(proto):
    with (
        patch.object(proto, "get_message_class", return_value=None),
        pytest.raises(AttributeError, match="Unknown Message"),
    ):
        proto.build_message("MissingMessage", {})


def test_liqi_proto_build_message_uses_parse_dict(proto):
    mock_cls = MagicMock()
    mock_obj = MagicMock()
    mock_cls.return_value = mock_obj
    mock_obj.SerializeToString.return_value = b"serialized"

    with (
        patch.object(proto, "get_message_class", return_value=mock_cls),
        patch("akagi_ng.bridge.majsoul.liqi.ParseDict") as mock_parse_dict,
    ):
        result = proto.build_message("Wrapper", {"foo": "bar"})

    mock_parse_dict.assert_called_once_with({"foo": "bar"}, mock_obj, ignore_unknown_fields=False)
    assert result == b"serialized"


def test_liqi_proto_build_packet_notify(proto):
    with patch.object(proto, "build_message", return_value=b"payload"):
        packet = proto.build_packet(MsgType.Notify, ".lq.Notify", {"x": 1})

    assert packet[0] == MsgType.Notify
    blocks = from_protobuf(packet[1:])
    assert blocks[0]["data"] == b".lq.Notify"
    assert blocks[1]["data"] == b"payload"


def test_liqi_proto_build_packet_req_and_res(proto):
    req_cls = MagicMock()
    req_cls.DESCRIPTOR.name = "Req"
    res_cls = MagicMock()
    res_cls.DESCRIPTOR.name = "Res"

    with (
        patch.object(proto, "get_rpc_message_classes", return_value=(req_cls, res_cls)),
        patch.object(proto, "build_message", return_value=b"payload"),
    ):
        req_packet = proto.build_packet(MsgType.Req, ".lq.Lobby.fetchInfo", {"a": 1}, msg_id=7)
        res_packet = proto.build_packet(MsgType.Res, ".lq.Lobby.fetchInfo", {"b": 2}, msg_id=8)

    assert req_packet[:3] == bytes([MsgType.Req]) + struct.pack("<H", 7)
    assert res_packet[:3] == bytes([MsgType.Res]) + struct.pack("<H", 8)
    req_blocks = from_protobuf(req_packet[3:])
    res_blocks = from_protobuf(res_packet[3:])
    assert req_blocks[0]["data"] == b".lq.Lobby.fetchInfo"
    assert req_blocks[1]["data"] == b"payload"
    assert res_blocks[0]["data"] == b""
    assert res_blocks[1]["data"] == b"payload"


def test_liqi_proto_build_packet_unknown_rpc_message(proto):
    with (
        patch.object(proto, "get_rpc_message_classes", return_value=(None, None)),
        pytest.raises(AttributeError, match="Unknown RPC message class"),
    ):
        proto.build_packet(MsgType.Req, ".lq.Lobby.fetchInfo", {})


def test_liqi_proto_build_packet_unsupported_msg_type(proto):
    req_cls = MagicMock()
    req_cls.DESCRIPTOR.name = "Req"
    res_cls = MagicMock()
    res_cls.DESCRIPTOR.name = "Res"

    with (
        patch.object(proto, "get_rpc_message_classes", return_value=(req_cls, res_cls)),
        patch.object(proto, "build_message", return_value=b"payload"),
        pytest.raises(ValueError, match="Unsupported message type"),
    ):
        proto.build_packet(99, ".lq.Lobby.fetchInfo", {})


def test_liqi_proto_parse_wrapper_unknown_message(proto):
    with patch.object(proto, "get_message_class", return_value=None):
        assert proto.parse_wrapper("Missing", b"data") is None


def test_liqi_proto_parse_notify_generic_path(proto):
    msg_cls = MagicMock()
    proto_obj = object()
    msg_cls.FromString.return_value = proto_obj
    with (
        patch.object(proto, "get_message_class", return_value=msg_cls),
        patch("akagi_ng.bridge.majsoul.liqi.MessageToDict", return_value={"ok": True}),
    ):
        method, payload = proto._parse_notify([{"data": b".lq.Lobby.notifySomething"}, {"data": b"raw"}])

    assert method == ".lq.Lobby.notifySomething"
    assert payload == {"ok": True}


def test_liqi_proto_parse_request_invalid_msg_block_size(proto):
    with pytest.raises(ValueError, match="Invalid msg_block size"):
        proto._parse_request(1, [{"data": b".lq.Lobby.fetchInfo"}])


def test_liqi_proto_parse_request_msg_id_too_large(proto):
    with pytest.raises(ValueError, match="exceeds max value"):
        proto._parse_request(1 << 16, [{"data": b".lq.Lobby.fetchInfo"}, {"data": b""}])


def test_liqi_proto_parse_response_first_block_not_empty(proto):
    proto.res_type[1] = (".lq.Lobby.fetchInfo", MagicMock())
    with pytest.raises(ValueError, match="Response first block not empty"):
        proto._parse_response(1, [{"data": b"x"}, {"data": b""}])


def test_liqi_proto_parse_response_without_pending_request(proto):
    with pytest.raises(ValueError, match="not found in pending requests"):
        proto._parse_response(999, [{"data": b""}, {"data": b""}])


def test_liqi_proto_parse_unknown_msg_type_returns_empty(proto):
    result = proto.parse(bytes([9, 0, 0]))
    assert result == {}


def test_to_protobuf_unknown_block_type():
    from akagi_ng.bridge.majsoul.liqi import to_protobuf

    with pytest.raises(KeyError, match="unknown"):
        to_protobuf([{"id": 1, "type": "unknown", "data": b""}])
