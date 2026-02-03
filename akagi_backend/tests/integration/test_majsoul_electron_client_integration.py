import base64
import json
import queue
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.core.notification_codes import NotificationCode
from akagi_ng.electron_client.majsoul import MajsoulElectronClient

# ... (fixture mock_majsoul_bridge remains same, but imports are now sorted)


@pytest.fixture
def mock_majsoul_bridge(monkeypatch):
    """Mock MajsoulBridge inside ElectronClient"""
    mock_bridge_cls = MagicMock()
    mock_bridge = MagicMock()
    mock_bridge_cls.return_value = mock_bridge

    # Configure mock bridge behavior
    # Default parse returns empty list
    mock_bridge.parse.return_value = []
    # IMPORTANT: Set game_ended to False explicitly, otherwise MagicMock is truthy
    mock_bridge.game_ended = False

    monkeypatch.setattr("akagi_ng.electron_client.majsoul.MajsoulBridge", mock_bridge_cls)
    return mock_bridge


def test_majsoul_electron_client_flow(mock_majsoul_bridge):
    """测试 Majsoul Electron Client 从连接到消息处理的完整流程"""
    q = queue.Queue()
    client = MajsoulElectronClient(shared_queue=q)
    client.start()

    assert client.running is True

    # 1. Simulate WebSocket Created (Connection)
    # The client filters URLs containing 'majsoul' etc.
    ws_created_msg = {"type": "websocket_created", "url": "wss://mj-srv-custom.mahjongsoul.com:9663/"}
    client.push_message(ws_created_msg)

    # Expect CLIENT_CONNECTED notification on first connection
    item = q.get(timeout=1.0)
    assert item["type"] == "system_event"
    assert item["code"] == NotificationCode.CLIENT_CONNECTED

    assert client._active_connections == 1

    # 2. Simulate WebSocket Frame (MJAI Message)
    # Construct a fake protobuf binary message (base64 encoded)
    # In reality this would be a valid Liqi proto, but since we mocked the bridge.parse,
    # any bytes will do as long as bridge.parse is called.
    fake_proto_bytes = b"\x02\x05\x08..."
    b64_data = base64.b64encode(fake_proto_bytes).decode("utf-8")

    ws_frame_msg = {"type": "websocket", "direction": "inbound", "data": b64_data}

    # Set mock bridge to return a fake MJAI event
    fake_mjai_event = {"type": "tsumo", "actor": 0, "pai": "5m"}
    mock_majsoul_bridge.parse.return_value = [fake_mjai_event]

    client.push_message(ws_frame_msg)

    # Verify bridge.parse was called with decoded bytes
    mock_majsoul_bridge.parse.assert_called()
    call_args = mock_majsoul_bridge.parse.call_args[0][0]
    assert call_args == fake_proto_bytes

    # Verify MJAI event put to queue
    item = q.get(timeout=1.0)
    assert item == fake_mjai_event

    # 3. Simulate Liqi Definition Update
    liqi_json = {"key": "value"}
    liqi_str = json.dumps(liqi_json)

    liqi_msg = {"type": "liqi_definition", "data": liqi_str}

    # We mock file operations to prevent actual file writing
    with (
        patch("akagi_ng.electron_client.majsoul.open", new_callable=MagicMock) as _,
        patch("akagi_ng.electron_client.majsoul.ensure_dir") as _,
        patch("akagi_ng.electron_client.majsoul.get_assets_dir") as mock_get_assets,
    ):
        mock_get_assets.return_value = Path("/")

        client.push_message(liqi_msg)

        # Verify MAJSOUL_PROTO_UPDATED event
        item = q.get(timeout=1.0)
        assert item["type"] == "system_event"
        assert item["code"] == NotificationCode.MAJSOUL_PROTO_UPDATED

    # 4. Simulate WebSocket Closed (Disconnect)
    ws_closed_msg = {"type": "websocket_closed"}
    client.push_message(ws_closed_msg)

    # Expect GAME_DISCONNECTED notification (if active connections drop to 0)
    item = q.get(timeout=1.0)
    assert item["type"] == "system_event"
    assert item["code"] == NotificationCode.GAME_DISCONNECTED

    assert client._active_connections == 0

    client.stop()


def test_majsoul_electron_client_debugger_detached(mock_majsoul_bridge):
    """测试调试器分离的情况"""
    q = queue.Queue()
    client = MajsoulElectronClient(shared_queue=q)
    client.start()

    # Set active connections manually for test
    client._active_connections = 1

    detach_msg = {"type": "debugger_detached"}
    client.push_message(detach_msg)

    assert client._active_connections == 0

    # Should emit GAME_DISCONNECTED
    item = q.get(timeout=1.0)
    assert item["type"] == "system_event"
    assert item["code"] == NotificationCode.GAME_DISCONNECTED

    client.stop()
