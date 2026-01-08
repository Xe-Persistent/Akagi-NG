import queue
import threading
import traceback

import mitmproxy.http
import mitmproxy.websocket

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.mitm_client.logger import logger

# Message queue to store parsed MJAI messages
mjai_messages: queue.Queue[dict] = queue.Queue()

# Store active flows and their bridges
activated_flows: list[str] = []
majsoul_bridges: dict[str, MajsoulBridge] = {}
bridge_lock = threading.Lock()


class MajsoulAddon:
    def websocket_start(self, flow: mitmproxy.http.HTTPFlow):
        """
        Called when a new WebSocket connection is established.
        """
        assert isinstance(flow.websocket, mitmproxy.websocket.WebSocketData)

        # We assume all WebSocket connections passing through this proxy port are relevant
        # or we could filter by URL if needed.
        logger.info(f"[MITM] WebSocket connection opened: {flow.id} ({flow.request.url})")

        activated_flows.append(flow.id)
        with bridge_lock:
            majsoul_bridges[flow.id] = MajsoulBridge()

    def websocket_message(self, flow: mitmproxy.http.HTTPFlow):
        """
        Called when a WebSocket message is received.
        """
        assert isinstance(flow.websocket, mitmproxy.websocket.WebSocketData)

        if flow.id not in activated_flows:
            return

        try:
            msg = flow.websocket.messages[-1]
            # direction = "<-" if msg.from_client else "->"
            # logger.trace(f"[MITM] {direction} Message: {msg.content}")

            with bridge_lock:
                if flow.id not in majsoul_bridges:
                    # Should not happen if activated_flows check passes, but for safety
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
        """
        Called when a WebSocket connection is closed.
        """
        if flow.id in activated_flows:
            logger.info(f"[MITM] WebSocket connection closed: {flow.id}")
            activated_flows.remove(flow.id)
            with bridge_lock:
                if flow.id in majsoul_bridges:
                    del majsoul_bridges[flow.id]
