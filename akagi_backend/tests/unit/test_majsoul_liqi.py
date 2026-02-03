import struct
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType


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
    header = bytes([MsgType.Req.value]) + struct.pack("<H", 123)
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

        # Mock MessageToDict for the outer wrapper
        with (
            patch("akagi_ng.bridge.majsoul.liqi.MessageToDict") as mock_m2d,
            patch("akagi_ng.bridge.majsoul.liqi.base64.b64decode", return_value=b"decoded"),
            patch("akagi_ng.bridge.majsoul.liqi.decode", return_value=b"xor_decoded"),
        ):
            # First call: outer wrapper
            # Second call: inner action
            mock_m2d.side_effect = [
                {"name": "ActionDiscardTile", "data": "base64_str"},  # Outer dict
                {"tile": "1m"},  # Inner dict
            ]

            method, dict_obj = proto._parse_notify(block)

            assert method == ".lq.Lobby.notifyAction"
            assert dict_obj["data"] == {"tile": "1m"}
            assert dict_obj["name"] == "ActionDiscardTile"


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
        mock_get_cls.side_effect = lambda name: MagicMock() if name == "notifyAction" else None
        mock_m2d.return_value = {"name": "UnknownAction", "data": "base64"}

        method, dict_obj = proto._parse_notify(block)
        assert method == ".lq.Lobby.notifyAction"
        assert dict_obj["data"] == "base64"  # Remains as string


def test_liqi_proto_full_parse_notify(proto):
    """测试 parse 方法处理 Notify 类型"""
    buf = bytes([MsgType.Notify.value]) + b"dummy_pb"
    with (
        patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[]),
        patch.object(proto, "_parse_notify", return_value=("method", {"d": 1})),
    ):
        res = proto.parse(buf)
        assert res["type"] == MsgType.Notify
        assert res["method"] == "method"


def test_liqi_proto_full_parse_response(proto):
    """测试 parse 方法处理 Res 类型"""
    buf = bytes([MsgType.Res.value]) + struct.pack("<H", 123) + b"dummy_pb"
    with (
        patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[]),
        patch.object(proto, "_parse_response", return_value=("method", {"d": 1})),
    ):
        res = proto.parse(buf)
        assert res["type"] == MsgType.Res
        assert res["id"] == 123


def test_liqi_proto_full_parse_error(proto):
    """测试 parse 方法处理异常（如数据截断）"""
    buf = bytes([MsgType.Res.value])  # Missing msg_id bytes
    res = proto.parse(buf)
    assert res == {}  # Exception caught and return empty dict


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
