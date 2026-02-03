import base64
import contextlib
import queue
from unittest.mock import mock_open, patch

import pytest

from akagi_ng.core import NotificationCode
from akagi_ng.core.constants import Platform
from akagi_ng.electron_client import (
    MajsoulElectronClient,
    TenhouElectronClient,
    create_electron_client,
)

# ==========================================================
# Factory Tests
# ==========================================================


def test_create_electron_client():
    q = queue.Queue()
    client = create_electron_client(Platform.MAJSOUL, shared_queue=q)
    assert isinstance(client, MajsoulElectronClient)

    client = create_electron_client(Platform.TENHOU, shared_queue=q)
    assert isinstance(client, TenhouElectronClient)

    client = create_electron_client(Platform.AUTO, shared_queue=q)
    assert isinstance(client, MajsoulElectronClient)


# ==========================================================
# Majsoul Client Tests
# ==========================================================


@pytest.fixture
def ms_client():
    q = queue.Queue()
    with patch("akagi_ng.electron_client.majsoul.MajsoulBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.game_ended = False
        client = MajsoulElectronClient(shared_queue=q)
    client.start()
    return client


def test_majsoul_lifecycle(ms_client):
    # Created
    ms_client.push_message({"type": "websocket_created", "url": "wss://majsoul.com/game"})
    assert ms_client._active_connections == 1
    assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.CLIENT_CONNECTED

    # Closed
    ms_client.push_message({"type": "websocket_closed"})
    assert ms_client._active_connections == 0
    assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.GAME_DISCONNECTED


def test_majsoul_debugger_events(ms_client):
    ms_client._active_connections = 1
    ms_client.push_message({"type": "debugger_detached"})
    assert ms_client._active_connections == 0
    assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.GAME_DISCONNECTED


def test_majsoul_liqi_update(ms_client):
    with (
        patch("akagi_ng.electron_client.majsoul.get_assets_dir"),
        patch("akagi_ng.electron_client.majsoul.ensure_dir"),
        patch("builtins.open", mock_open()),
    ):
        ms_client.push_message({"type": "liqi_definition", "data": '{"test":1}'})
        assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.MAJSOUL_PROTO_UPDATED

    # Fail case
    ms_client.push_message({"type": "liqi_definition", "data": "invalid json"})
    assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.MAJSOUL_PROTO_UPDATE_FAILED


def test_majsoul_frames(ms_client):
    ms_client.bridge.parse.return_value = [{"type": "msg1"}, {"type": "end_game"}]
    ms_client.push_message({"type": "websocket", "data": base64.b64encode(b"raw").decode()})

    assert ms_client.message_queue.get(timeout=2.0)["type"] == "msg1"
    assert ms_client.message_queue.get(timeout=2.0)["type"] == "end_game"
    assert ms_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.RETURN_LOBBY


# ==========================================================
# Tenhou Client Tests
# ==========================================================


@pytest.fixture
def th_client():
    q = queue.Queue()
    with patch("akagi_ng.electron_client.tenhou.TenhouBridge") as mock_bridge_cls:
        mock_bridge = mock_bridge_cls.return_value
        mock_bridge.game_ended = False
        client = TenhouElectronClient(shared_queue=q)
    client.start()
    return client


def test_tenhou_lifecycle(th_client):
    th_client.push_message({"type": "websocket_created", "url": "https://tenhou.net/3/"})
    assert th_client._active_connections == 1
    assert th_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.CLIENT_CONNECTED

    th_client.push_message({"type": "websocket_closed"})
    assert th_client._active_connections == 0
    assert th_client.message_queue.get(timeout=2.0)["code"] == NotificationCode.GAME_DISCONNECTED


def test_tenhou_frames(th_client):
    # Text frame
    th_client.bridge.parse.return_value = [{"type": "msg1"}]
    th_client.push_message({"type": "websocket", "direction": "inbound", "data": "HELO"})

    msg = th_client.message_queue.get(timeout=2.0)
    assert msg.get("type") == "msg1"

    # Binary frame
    th_client.push_message(
        {"type": "websocket", "direction": "inbound", "opcode": 2, "data": base64.b64encode(b"binary").decode()}
    )
    th_client.bridge.parse.assert_called_with(b"binary")

    # Exception handle
    th_client.bridge.parse.side_effect = Exception("crash")
    th_client.push_message({"type": "websocket", "direction": "inbound", "data": "FAIL"})

    # Process remaining binary message if any
    with contextlib.suppress(queue.Empty):
        th_client.message_queue.get(timeout=0.1)

    assert th_client.message_queue.empty()
