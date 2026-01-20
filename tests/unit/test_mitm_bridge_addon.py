from unittest.mock import patch

from akagi_ng.bridge.amatsuki.bridge import AmatsukiBridge
from akagi_ng.bridge.majsoul.bridge import MajsoulBridge
from akagi_ng.bridge.riichi_city.bridge import RiichiCityBridge
from akagi_ng.bridge.tenhou.bridge import TenhouBridge
from akagi_ng.core.constants import Platform
from akagi_ng.mitm_client.bridge_addon import BridgeAddon


def test_bridge_addon_majsoul(mock_flow):
    mock_flow.request.url = "wss://mj-jp.majsoul.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.MAJSOUL

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), MajsoulBridge)


def test_bridge_addon_tenhou(mock_flow):
    mock_flow.request.url = "wss://tenhou.net/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.TENHOU

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), TenhouBridge)


def test_bridge_addon_amatsuki(mock_flow):
    mock_flow.request.url = "wss://amatsukimj.jp/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.AMATSUKI

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), AmatsukiBridge)


def test_bridge_addon_riichi_city(mock_flow):
    mock_flow.request.url = "wss://mahjong-jp.city/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.RIICHI_CITY

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), RiichiCityBridge)


def test_bridge_addon_filtering(mock_flow):
    mock_flow.request.url = "wss://random-site.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.MAJSOUL

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        # Should filter out because URL does not match 'majsoul'
        assert "test_flow_id" not in addon.activated_flows
        assert "test_flow_id" not in addon.bridges


def test_bridge_addon_auto_detect(mock_flow):
    """Test AUTO platform detection"""
    mock_flow.request.url = "wss://mj-jp.majsoul.com/socket"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.AUTO

        addon = BridgeAddon()
        addon.websocket_start(mock_flow)

        assert "test_flow_id" in addon.activated_flows
        assert isinstance(addon.bridges.get("test_flow_id"), MajsoulBridge)


def test_bridge_addon_ignore_unrelated(mock_flow):
    """Test ignoring unrelated URLs in AUTO mode"""
    mock_flow.request.url = "wss://google.com"
    with patch("akagi_ng.mitm_client.bridge_addon.local_settings") as mock_settings:
        mock_settings.mitm.platform = Platform.AUTO
        addon = BridgeAddon()
        addon.websocket_start(mock_flow)
        assert "test_flow_id" not in addon.activated_flows
