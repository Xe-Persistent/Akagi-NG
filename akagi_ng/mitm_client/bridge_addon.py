import queue
import threading
import traceback

import mitmproxy.http
import mitmproxy.websocket

from akagi_ng.bridge import (
    AmatsukiBridge,
    BaseBridge,
    MajsoulBridge,
    RiichiCityBridge,
    TenhouBridge,
)
from akagi_ng.core.constants import Platform
from akagi_ng.mitm_client.logger import logger
from akagi_ng.settings import local_settings


class BridgeAddon:
    def __init__(self):
        self.active_majsoul_flow: mitmproxy.http.HTTPFlow | None = None

        # 存储已解析 MJAI 消息的消息队列
        self.mjai_messages: queue.Queue[dict] = queue.Queue()

        # 存储活动的流及其对应的 Bridge
        self.activated_flows: list[str] = []
        self.bridges: dict[str, BaseBridge] = {}
        self.bridge_lock = threading.Lock()

        # 连接状态跟踪
        self._active_connections = 0

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

        self.activated_flows.append(flow.id)
        with self.bridge_lock:
            if platform == Platform.MAJSOUL:
                self.bridges[flow.id] = MajsoulBridge()
            elif platform == Platform.TENHOU:
                self.bridges[flow.id] = TenhouBridge()
            elif platform == Platform.AMATSUKI:
                self.bridges[flow.id] = AmatsukiBridge()
            elif platform == Platform.RIICHI_CITY:
                self.bridges[flow.id] = RiichiCityBridge()
            else:
                logger.error(f"Unsupported platform: {platform}")
                return

            # 更新连接计数并发送通知
            self._on_connection_established()

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
        if flow.id not in self.activated_flows:
            return

        try:
            msg = flow.websocket.messages[-1]
            direction = "<-" if msg.from_client else "->"
            logger.trace(f"[MITM] {direction} Message: {msg.content}")

            with self.bridge_lock:
                if flow.id not in self.bridges:
                    return
                bridge = self.bridges[flow.id]
                msgs = bridge.parse(msg.content)

            if msgs:
                for m in msgs:
                    self.mjai_messages.put(m)

        except Exception as e:
            logger.error(f"[MITM] Error parsing message: {e}")
            logger.error(traceback.format_exc())

    def _on_connection_established(self):
        """处理连接建立事件"""
        self._active_connections += 1
        is_first_connection = self._active_connections == 1

        # 只在第一个连接建立时发送通知
        if is_first_connection:
            self.mjai_messages.put({"type": "system_event", "code": "client_connected"})
            logger.info("[MITM] Client connected (first connection)")

    def websocket_end(self, flow: mitmproxy.http.HTTPFlow):
        if flow.id in self.activated_flows:
            logger.info(f"[MITM] WebSocket connection closed: {flow.id}")
            self.activated_flows.remove(flow.id)
            with self.bridge_lock:
                if flow.id in self.bridges:
                    bridge = self.bridges[flow.id]
                    game_ended = getattr(bridge, "game_ended", False)
                    del self.bridges[flow.id]

                    # 更新连接计数并发送通知
                    self._on_connection_closed(game_ended)

    def _on_connection_closed(self, game_ended: bool):
        """处理连接关闭事件"""
        self._active_connections = max(0, self._active_connections - 1)
        all_connections_closed = self._active_connections == 0

        # 只在所有连接都关闭时发送断线通知
        if all_connections_closed:
            code = "return_lobby" if game_ended else "game_disconnected"
            self.mjai_messages.put({"type": "system_event", "code": code})
            logger.info(f"[MITM] All connections closed, sending {code}")

    def get_active_bridge(self) -> BaseBridge | None:
        """
        Get the bridge instance associated with the active Majsoul connection.
        """
        if self.active_majsoul_flow and self.active_majsoul_flow.id in self.bridges:
            return self.bridges[self.active_majsoul_flow.id]
        return None
