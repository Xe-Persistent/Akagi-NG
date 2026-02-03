import queue
import threading
import time
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
from akagi_ng.core import NotificationCode
from akagi_ng.core.constants import Platform
from akagi_ng.mitm_client.logger import logger
from akagi_ng.settings import local_settings

# Mapping of platforms to URL patterns for detection
PLATFORM_URL_PATTERNS = {
    Platform.MAJSOUL: ["majsoul", "maj-soul"],
    Platform.TENHOU: ["tenhou.net", "nodocchi"],
    Platform.AMATSUKI: ["amatsukimj", "amatsuki"],
    Platform.RIICHI_CITY: ["mahjong-jp.city", "riichicity"],
}


class BridgeAddon:
    def __init__(self, shared_queue: queue.Queue[dict]):
        self.active_majsoul_flow: mitmproxy.http.HTTPFlow | None = None
        # 共享的消息队列（事件驱动模式）
        self.mjai_messages = shared_queue

        # 存储活动的流及其对应的 Bridge
        self.activated_flows: list[str] = []
        self.bridges: dict[str, BaseBridge] = {}
        self.last_activity: dict[str, float] = {}  # flow_id -> timestamp
        self.bridge_lock = threading.Lock()

        # 连接状态跟踪
        self._active_connections = 0

    def _get_platform_for_flow(self, flow: mitmproxy.http.HTTPFlow) -> Platform | None:
        url = flow.request.url.lower()

        for platform, patterns in PLATFORM_URL_PATTERNS.items():
            if any(pattern in url for pattern in patterns):
                return platform

        return None

    def websocket_start(self, flow: mitmproxy.http.HTTPFlow):
        configured_platform = local_settings.platform
        detected_platform = self._get_platform_for_flow(flow)

        target_platform = configured_platform if configured_platform != Platform.AUTO else detected_platform

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

            self.last_activity[flow.id] = time.time()
            # 更新连接计数并发送通知
            self._on_connection_established()

    def request(self, flow: mitmproxy.http.HTTPFlow):
        """处理 HTTP 请求"""
        # 如果是已知 WebSocket 流的 HTTP 握手或后续请求
        if flow.id in self.bridges:
            bridge = self.bridges[flow.id]
            if hasattr(bridge, "request"):
                bridge.request(flow)
            return

        # 否则尝试根据配置或 URL 探测平台
        configured_platform = local_settings.platform
        target_platform = configured_platform
        if target_platform == Platform.AUTO:
            target_platform = self._get_platform_for_flow(flow)

        if target_platform == Platform.AMATSUKI:
            # 天月平台特殊处理：即便没有 WebSocket 流也需要拦截心跳
            # 这里临时创建一个 Bridge 实例来处理（或者可以使用静态方法，但为了统一接口采用实例）
            AmatsukiBridge().request(flow)

    def response(self, flow: mitmproxy.http.HTTPFlow):
        """处理 HTTP 响应"""
        if flow.id in self.bridges:
            bridge = self.bridges[flow.id]
            if hasattr(bridge, "response"):
                bridge.response(flow)
            return

        configured_platform = local_settings.platform
        target_platform = configured_platform
        if target_platform == Platform.AUTO:
            target_platform = self._get_platform_for_flow(flow)

        if target_platform == Platform.AMATSUKI:
            AmatsukiBridge().response(flow)

    def _is_target_platform(self, flow: mitmproxy.http.HTTPFlow, platform: Platform) -> bool:
        url = flow.request.url.lower()
        patterns = PLATFORM_URL_PATTERNS.get(platform, [])
        return any(pattern in url for pattern in patterns) if patterns else True

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
                self.last_activity[flow.id] = time.time()
                msgs = bridge.parse(msg.content)

            if msgs:
                for m in msgs:
                    try:
                        self.mjai_messages.put(m, block=False)
                    except queue.Full:
                        logger.warning("[MITM] MJAI message queue is full, dropping message.")

        except Exception as e:
            logger.error(f"[MITM] Error parsing message: {e}")
            logger.error(traceback.format_exc())

    def _on_connection_established(self):
        """处理连接建立事件"""
        self._active_connections += 1
        is_first_connection = self._active_connections == 1

        # 只在第一个连接建立时发送通知
        if is_first_connection:
            self.mjai_messages.put({"type": "system_event", "code": NotificationCode.CLIENT_CONNECTED})
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
                    self.last_activity.pop(flow.id, None)

                    # 更新连接计数并发送通知
                    self._on_connection_closed(game_ended)

    def _on_connection_closed(self, game_ended: bool):
        """处理连接关闭事件"""
        self._active_connections = max(0, self._active_connections - 1)
        all_connections_closed = self._active_connections == 0

        # 只在所有连接都关闭时发送断线通知
        if all_connections_closed:
            from akagi_ng.core import NotificationCode

            code = NotificationCode.RETURN_LOBBY if game_ended else NotificationCode.GAME_DISCONNECTED
            self.mjai_messages.put({"type": "system_event", "code": code})
            logger.info(f"[MITM] All connections closed, sending {code}")

    def get_active_bridge(self) -> BaseBridge | None:
        """
        Get the bridge instance associated with the active Majsoul connection.
        """
        if self.active_majsoul_flow and self.active_majsoul_flow.id in self.bridges:
            return self.bridges[self.active_majsoul_flow.id]
        return None

    def _cleanup_stale_bridges(self, max_age_seconds: int = 300):
        """清理超过指定时间未活动的bridge"""
        current_time = time.time()
        with self.bridge_lock:
            for flow_id in list(self.bridges.keys()):
                # 情况1：已经在 activated_flows 之外（可能 websocket_end 没删干净）
                # 情况2：虽然在 activated_flows，但太久没说话了 (max_age_seconds)
                last_active = self.last_activity.get(flow_id, 0)
                is_stale = (current_time - last_active) > max_age_seconds

                if flow_id not in self.activated_flows or is_stale:
                    logger.warning(f"[MITM] Cleaning up stale bridge for flow {flow_id} (stale={is_stale})")
                    if flow_id in self.bridges:
                        del self.bridges[flow_id]
                    self.last_activity.pop(flow_id, None)
                    if flow_id in self.activated_flows:
                        self.activated_flows.remove(flow_id)
                        self._active_connections = max(0, self._active_connections - 1)
