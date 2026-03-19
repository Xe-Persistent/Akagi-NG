"""
测试模块：akagi_backend/tests/unit/test_mitm_bridge_addon.py

描述：针对 MITMProxy 插件 (BridgeAddon) 的单元测试。
主要测试点：
- 根据配置 (Auto/Manual) 和域名自动识别并激活对应的 Bridge 实例。
- WebSocket 生命周期钩子 (start, message, end) 的拦截与转发。
- HTTP 钩子对天月 (Amatsuki) 心跳包等请求的拦截处理。
- 过期 Bridge 实例的自动清理逻辑。
"""

import queue
from unittest.mock import MagicMock, patch

import pytest
from mitmproxy.websocket import WebSocketMessage

from akagi_ng.bridge import (
    AmatsukiBridge,
    MajsoulBridge,
    RiichiCityBridge,
    TenhouBridge,
)
from akagi_ng.mitm_client.bridge_addon import BridgeAddon


@pytest.fixture
def shared_queue():
    return queue.Queue()


@pytest.fixture
def addon(shared_queue):
    return BridgeAddon(shared_queue)


def test_bridge_addon_majsoul(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://mj-jp.majsoul.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "majsoul"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), MajsoulBridge)


def test_bridge_addon_tenhou(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://tenhou.net/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "tenhou"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), TenhouBridge)


def test_bridge_addon_amatsuki(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://amatsukimj.jp/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "amatsuki"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), AmatsukiBridge)


def test_bridge_addon_riichi_city(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://mahjong-jp.city/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "riichi_city"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), RiichiCityBridge)


def test_bridge_addon_filtering(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://random-site.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "auto"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" not in addon.activated_flows


def test_bridge_addon_manual_force(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://random-site.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "majsoul"
        addon.websocket_start(mock_flow)
        # In manual mode, we force activation even on unrecognized domains
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), MajsoulBridge)


def test_bridge_addon_auto_detect(addon):
    mock_flow = MagicMock()
    mock_flow.id = "test_flow_id"
    mock_flow.request.url = "wss://mj-jp.majsoul.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "auto"
        addon.websocket_start(mock_flow)
        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), MajsoulBridge)


def test_bridge_addon_platform_detection(addon) -> None:
    flow_tenhou = MagicMock()
    flow_tenhou.request.url = "http://tenhou.net/3/"
    assert addon._get_platform_for_flow(flow_tenhou) == "tenhou"

    flow_ms = MagicMock()
    flow_ms.request.url = "https://majsoul.com/game/"
    assert addon._get_platform_for_flow(flow_ms) == "majsoul"


def test_bridge_addon_websocket_lifecycle(addon, shared_queue) -> None:
    flow = MagicMock()
    flow.id = "flow1"
    flow.request.url = "http://tenhou.net/3/"

    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "auto"
        addon.websocket_start(flow)
        assert flow.id in addon.activated_flows
        conn_msg = shared_queue.get(timeout=1)
        assert conn_msg.type == "system_event"

    msg = MagicMock()
    msg.content = b"fake_tenhou_msg"
    msg.from_client = True
    flow.websocket.messages = [msg]

    with patch.object(addon.bridges[flow.id], "parse", return_value=[{"type": "hello"}]):
        addon.websocket_message(flow)
        mjai_msg = shared_queue.get(timeout=1)
        assert mjai_msg["type"] == "hello"

    addon.websocket_end(flow)
    assert flow.id not in addon.activated_flows


def test_bridge_addon_websocket_mutation(addon):
    flow = MagicMock()
    flow.id = "flow1"
    flow.request.url = "http://majsoul.com/socket"
    flow.websocket.messages = [WebSocketMessage(2, True, b"orig")]

    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.platform = "majsoul"
        addon.websocket_start(flow)

    bridge = addon.bridges[flow.id]
    mutation = MagicMock()
    mutation.drop = False
    mutation.content = b"patched"
    mutation.injected_messages = [b"injected"]

    with patch.object(bridge, "process_message", return_value=([{"type": "hello"}], mutation)):
        addon.websocket_message(flow)

    assert flow.websocket.messages[0].content == b"patched"
    assert flow.websocket.messages[-1].content == b"injected"
    assert flow.websocket.messages[-1].injected is True


def test_bridge_addon_http_hooks_dispatch(addon) -> None:
    flow = MagicMock()
    flow.id = "flow1"

    # Create a mock bridge with request/response methods
    mock_bridge = MagicMock()
    addon.bridges[flow.id] = mock_bridge

    # Test request delegation
    addon.request(flow)
    mock_bridge.request.assert_called_once_with(flow)

    # Test response delegation
    addon.response(flow)
    mock_bridge.response.assert_called_once_with(flow)


def test_bridge_addon_amatsuki_heartbeat_patch(addon) -> None:
    flow = MagicMock()
    flow.id = "heartbeat_flow"
    flow.request.url = "http://amatsukimj.jp/api/heartbeat"

    with (
        patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings,
        patch("akagi_ng.mitm_client.bridge_addon.AmatsukiBridge") as mock_bridge_class,
    ):
        mock_settings.platform = "amatsuki"

        # Test request patching
        addon.request(flow)
        mock_bridge_class.return_value.request.assert_called_once_with(flow)

        # Test response patching
        addon.response(flow)
        mock_bridge_class.return_value.response.assert_called_once_with(flow)


def test_bridge_addon_cleanup(addon) -> None:
    flow = MagicMock()
    flow.id = "stale_flow"
    addon.activated_flows.append(flow.id)
    addon.bridges[flow.id] = MagicMock()
    addon.last_activity[flow.id] = 0.0

    addon._cleanup_stale_bridges(max_age_seconds=10)
    assert flow.id not in addon.activated_flows
    assert flow.id not in addon.bridges


def test_bridge_addon_queue_full_drops_system_event():
    shared_queue = queue.Queue(maxsize=1)
    shared_queue.put_nowait({"sentinel": True})
    addon = BridgeAddon(shared_queue)

    addon._on_connection_established()
    assert addon._active_connections == 1
    assert shared_queue.qsize() == 1
