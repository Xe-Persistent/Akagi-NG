import struct
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.majsoul.liqi import LiqiProto, MsgType
import contextlib


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


def test_liqi_proto_dispatch_logic():
    parser = LiqiProto()
    with patch("akagi_ng.bridge.majsoul.liqi.from_protobuf", return_value=[".lq.ActionNewRound", b"data"]):
        with contextlib.suppress(Exception):
            parser._parse_notify([".lq.ActionNewRound", b"data"])


def test_liqi_proto_invalid_structure():
    parser = LiqiProto()
    res = parser.parse(b"\x00\x00\x00\x00\x01")
    assert res == {}
