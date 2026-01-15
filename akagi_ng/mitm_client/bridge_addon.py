import queue
import threading
import traceback

import mitmproxy.http
import mitmproxy.websocket

from akagi_ng.bridge import (
    AmatsukiBridge,
    MajsoulBridge,
    RiichiCityBridge,
    TenhouBridge,
)
from akagi_ng.bridge.base import BaseBridge
from akagi_ng.core.constants import Platform
from akagi_ng.mitm_client.logger import logger
from akagi_ng.settings import local_settings

# 用于存储已解析 MJAI 消息的消息队列
mjai_messages: queue.Queue[dict] = queue.Queue()

# 存储活动的流及其对应的 Bridge
activated_flows: list[str] = []
bridges: dict[str, BaseBridge] = {}
bridge_lock = threading.Lock()


class BridgeAddon:
    def _get_platform_for_flow(self, flow: mitmproxy.http.HTTPFlow) -> Platform | None:
        url = flow.request.url

        # Check patterns for each platform
        if "majsoul" in url or "maj-soul" in url:
            return Platform.MAJSOUL
        if "tenhou.net" in url or "nodocchi" in url:
            return Platform.TENHOU
        if "amatsukimj" in url or "amatsuki" in url:
            return Platform.AMATSUKI
        if "mahjong-jp.city" in url or "riichicity" in url:
            return Platform.RIICHI_CITY

        return None

    def websocket_start(self, flow: mitmproxy.http.HTTPFlow):
        configured_platform = local_settings.mitm.platform
        detected_platform = self._get_platform_for_flow(flow)

        target_platform = None

        if configured_platform in (Platform.AUTO, detected_platform):
            target_platform = detected_platform

        if not target_platform:
            return

        platform = target_platform

        logger.info(f"[MITM] WebSocket connection opened: {flow.id} ({flow.request.url}) for {platform.value}")

        activated_flows.append(flow.id)
        with bridge_lock:
            if platform == Platform.MAJSOUL:
                bridges[flow.id] = MajsoulBridge()
            elif platform == Platform.TENHOU:
                bridges[flow.id] = TenhouBridge()
            elif platform == Platform.AMATSUKI:
                bridges[flow.id] = AmatsukiBridge()
            elif platform == Platform.RIICHI_CITY:
                bridges[flow.id] = RiichiCityBridge()
            else:
                logger.error(f"Unsupported platform: {platform}")
                return

        # Notify system that client is connected
        mjai_messages.put({"type": "system_event", "code": "client_connected"})

    def _is_target_platform(self, flow: mitmproxy.http.HTTPFlow, platform: Platform) -> bool:
        url = flow.request.url
        if platform == Platform.MAJSOUL:
            return "majsoul" in url or "maj-soul" in url
        if platform == Platform.TENHOU:
            # Tenhou usually uses TCP, but WS wrapper might be used
            return "tenhou.net" in url or "nodocchi" in url
        if platform == Platform.AMATSUKI:
            return "amatsukimj" in url or "amatsuki" in url
        if platform == Platform.RIICHI_CITY:
            return "mahjong-jp.city" in url or "riichicity" in url
        return True

    def websocket_message(self, flow: mitmproxy.http.HTTPFlow):
        if flow.id not in activated_flows:
            return

        try:
            msg = flow.websocket.messages[-1]
            direction = "<-" if msg.from_client else "->"
            logger.trace(f"[MITM] {direction} Message: {msg.content}")

            with bridge_lock:
                if flow.id not in bridges:
                    return
                bridge = bridges[flow.id]
                msgs = bridge.parse(msg.content)

            if msgs:
                for m in msgs:
                    mjai_messages.put(m)

        except Exception as e:
            logger.error(f"[MITM] Error parsing message: {e}")
            logger.error(traceback.format_exc())

    def websocket_end(self, flow: mitmproxy.http.HTTPFlow):
        if flow.id in activated_flows:
            logger.info(f"[MITM] WebSocket connection closed: {flow.id}")
            activated_flows.remove(flow.id)
            with bridge_lock:
                if flow.id in bridges:
                    bridge = bridges[flow.id]
                    # Check if game ended gracefully
                    game_ended = getattr(bridge, "game_ended", False)
                    del bridges[flow.id]

                    code = "return_lobby" if game_ended else "game_disconnected"
                    mjai_messages.put({"type": "system_event", "code": code})
