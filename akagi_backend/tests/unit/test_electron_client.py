import base64
import queue
from unittest.mock import patch

from akagi_ng.core.constants import Platform
from akagi_ng.electron_client import (
    MajsoulElectronClient,
    TenhouElectronClient,
    create_electron_client,
)


def test_create_electron_client():
    q = queue.Queue()
    client = create_electron_client(Platform.MAJSOUL, shared_queue=q)
    assert isinstance(client, MajsoulElectronClient)
    assert client.message_queue is q

    client = create_electron_client(Platform.TENHOU, shared_queue=q)
    assert isinstance(client, TenhouElectronClient)
    assert client.message_queue is q

    client = create_electron_client(Platform.AUTO, shared_queue=q)
    assert isinstance(client, MajsoulElectronClient)

    client = create_electron_client(Platform.AMATSUKI, shared_queue=q)
    assert client is None


def test_majsoul_electron_client_push_websocket():
    with patch("akagi_ng.electron_client.majsoul.MajsoulBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        q = queue.Queue()
        client = MajsoulElectronClient(shared_queue=q)
        client.start()

        # Binary frame (CDP sends as base64)
        payload = {"type": "websocket", "opcode": 2, "data": base64.b64encode(b"binary_data").decode()}
        client.push_message(payload)

        # 检查队列内容
        msgs = []
        while not q.empty():
            msgs.append(q.get())

        assert len(msgs) == 1
        assert msgs[0]["type"] == "mjai_msg"
        mock_bridge.parse.assert_called_with(b"binary_data")


def test_tenhou_electron_client_push_websocket_text():
    with patch("akagi_ng.electron_client.tenhou.TenhouBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        q = queue.Queue()
        client = TenhouElectronClient(shared_queue=q)
        client.start()

        # Text frame
        payload = {"type": "websocket", "opcode": 1, "data": '{"tag":"INIT"}'}
        client.push_message(payload)

        msgs = []
        while not q.empty():
            msgs.append(q.get())

        assert len(msgs) == 1
        mock_bridge.parse.assert_called_with(b'{"tag":"INIT"}')


def test_tenhou_electron_client_push_websocket_binary():
    with patch("akagi_ng.electron_client.tenhou.TenhouBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.parse.return_value = [{"type": "mjai_msg"}]

        q = queue.Queue()
        client = TenhouElectronClient(shared_queue=q)
        client.start()

        # Binary frame
        payload = {"type": "websocket", "opcode": 2, "data": base64.b64encode(b"binary_data").decode()}
        client.push_message(payload)

        msgs = []
        while not q.empty():
            msgs.append(q.get())

        assert len(msgs) == 1
        mock_bridge.parse.assert_called_with(b"binary_data")
