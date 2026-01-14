import queue
import threading
import traceback

import mitmproxy.http
import mitmproxy.websocket

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.mitm_client.logger import logger

# 用于存储已解析 MJAI 消息的消息队列
mjai_messages: queue.Queue[dict] = queue.Queue()

# 存储活动的流及其对应的 Bridge
activated_flows: list[str] = []
majsoul_bridges: dict[str, MajsoulBridge] = {}
bridge_lock = threading.Lock()


class MajsoulAddon:
    def websocket_start(self, flow: mitmproxy.http.HTTPFlow):
        logger.info(f"[MITM] WebSocket connection opened: {flow.id} ({flow.request.url})")

        activated_flows.append(flow.id)
        with bridge_lock:
            majsoul_bridges[flow.id] = MajsoulBridge()

        # 发送客户端连接成功通知
        mjai_messages.put({"type": "system_event", "code": "client_connected"})

    def websocket_message(self, flow: mitmproxy.http.HTTPFlow):
        if flow.id not in activated_flows:
            return

        try:
            msg = flow.websocket.messages[-1]
            direction = "<-" if msg.from_client else "->"
            logger.trace(f"[MITM] {direction} Message: {msg.content}")

            with bridge_lock:
                if flow.id not in majsoul_bridges:
                    return
                bridge = majsoul_bridges[flow.id]
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
                if flow.id in majsoul_bridges:
                    bridge = majsoul_bridges[flow.id]
                    game_ended = getattr(bridge, "game_ended", False)
                    del majsoul_bridges[flow.id]
                    code = "return_lobby" if game_ended else "game_disconnected"
                    mjai_messages.put({"type": "system_event", "code": code})
