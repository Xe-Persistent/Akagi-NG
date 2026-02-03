"""Tenhou Electron Client 集成测试"""

import queue
from unittest.mock import MagicMock

import pytest

from akagi_ng.core.notification_codes import NotificationCode
from akagi_ng.electron_client.tenhou import TenhouElectronClient


@pytest.fixture
def mock_tenhou_bridge(monkeypatch):
    """Mock TenhouBridge inside ElectronClient"""
    mock_bridge_cls = MagicMock()
    mock_bridge = MagicMock()
    mock_bridge_cls.return_value = mock_bridge

    # Configure mock bridge behavior
    mock_bridge.parse.return_value = []
    # IMPORTANT: Set game_ended to False explicitly
    mock_bridge.game_ended = False

    monkeypatch.setattr("akagi_ng.electron_client.tenhou.TenhouBridge", mock_bridge_cls)
    return mock_bridge


def test_tenhou_electron_client_flow(mock_tenhou_bridge):
    """测试 Tenhou Electron Client 从连接到消息处理的完整流程"""
    q = queue.Queue()
    client = TenhouElectronClient(shared_queue=q)
    client.start()

    assert client.running is True

    # 1. Connection Filtering
    # Should ignore non-Tenhou URLs
    client.push_message({"type": "websocket_created", "url": "wss://google.com"})
    assert client._active_connections == 0

    # Should accept Tenhou URLs
    ws_created_msg = {"type": "websocket_created", "url": "https://tenhou.net/3/?ws"}
    client.push_message(ws_created_msg)

    # Expect CLIENT_CONNECTED notification
    item = q.get(timeout=1.0)
    assert item["type"] == "system_event"
    assert item["code"] == NotificationCode.CLIENT_CONNECTED

    assert client._active_connections == 1

    # 2. WebSocket Frame (Text - HELO)
    ws_text_msg = {
        "type": "websocket",
        "direction": "inbound",  # Only inbound is processed
        "data": '{"tag": "HELO", "name": "NoName"}',
        "opcode": 1,  # WS_TEXT
    }

    # Mock bridge parsing result
    fake_helo_event = {"type": "none", "raw": "HELO"}
    mock_tenhou_bridge.parse.return_value = [fake_helo_event]

    client.push_message(ws_text_msg)

    # Verify bridge.parse called with utf-8 bytes
    mock_tenhou_bridge.parse.assert_called()
    call_args = mock_tenhou_bridge.parse.call_args[0][0]
    assert call_args == b'{"tag": "HELO", "name": "NoName"}'

    # Verify queue
    item = q.get(timeout=1.0)
    assert item == fake_helo_event

    # 3. WebSocket Frame (Binary)
    # Simulate a binary frame (Base64 encoded in CDP)
    import base64

    fake_binary = b"\x01\x02\x03"
    b64_data = base64.b64encode(fake_binary).decode("utf-8")

    ws_binary_msg = {
        "type": "websocket",
        "direction": "inbound",
        "data": b64_data,
        "opcode": 2,  # WS_BINARY
    }

    fake_binary_event = {"type": "tsumo", "pai": "1m"}
    mock_tenhou_bridge.parse.return_value = [fake_binary_event]

    client.push_message(ws_binary_msg)

    # Verify bridge.parse called with decoded bytes
    call_args = mock_tenhou_bridge.parse.call_args[0][0]
    assert call_args == fake_binary

    item = q.get(timeout=1.0)
    assert item == fake_binary_event

    # 4. Outbound filtered
    outbound_msg = {"type": "websocket", "direction": "outbound", "data": "ignore me"}
    mock_tenhou_bridge.parse.reset_mock()
    client.push_message(outbound_msg)
    mock_tenhou_bridge.parse.assert_not_called()

    # 5. Disconnect
    client.push_message({"type": "websocket_closed"})

    item = q.get(timeout=1.0)
    assert item["type"] == "system_event"
    assert item["code"] == NotificationCode.GAME_DISCONNECTED

    client.stop()
