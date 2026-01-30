import base64
from unittest.mock import patch

from akagi_ng.core.constants import Platform
from akagi_ng.electron_client import (
    MajsoulElectronClient,
    TenhouElectronClient,
    create_electron_client,
)


def test_create_electron_client():
    client = create_electron_client(Platform.MAJSOUL)
    assert isinstance(client, MajsoulElectronClient)

    client = create_electron_client(Platform.TENHOU)
    assert isinstance(client, TenhouElectronClient)

    client = create_electron_client(Platform.AUTO)
    assert isinstance(client, MajsoulElectronClient)

    client = create_electron_client(Platform.AMATSUKI)
    assert client is None


def test_majsoul_electron_client_push_websocket():
    with patch("akagi_ng.electron_client.majsoul.MajsoulBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        client = MajsoulElectronClient()
        client.start()

        # Binary frame (CDP sends as base64)
        payload = {"type": "websocket", "opcode": 2, "data": base64.b64encode(b"binary_data").decode()}
        client.push_message(payload)

        msgs = client.dump_messages()
        assert len(msgs) == 1
        assert msgs[0]["type"] == "mjai_msg"
        mock_bridge.parse.assert_called_with(b"binary_data")


def test_tenhou_electron_client_push_websocket_text():
    with patch("akagi_ng.electron_client.tenhou.TenhouBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        client = TenhouElectronClient()
        client.start()

        # Text frame
        payload = {"type": "websocket", "opcode": 1, "data": '{"tag":"INIT"}'}
        client.push_message(payload)

        msgs = client.dump_messages()
        assert len(msgs) == 1
        mock_bridge.parse.assert_called_with(b'{"tag":"INIT"}')


def test_tenhou_electron_client_push_websocket_binary():
    with patch("akagi_ng.electron_client.tenhou.TenhouBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        client = TenhouElectronClient()
        client.start()

        # Binary frame
        payload = {"type": "websocket", "opcode": 2, "data": base64.b64encode(b"binary_data").decode()}
        client.push_message(payload)

        msgs = client.dump_messages()
        assert len(msgs) == 1
        mock_bridge.parse.assert_called_with(b"binary_data")
