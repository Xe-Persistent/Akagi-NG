from __future__ import annotations

import queue

from akagi_ng.bridge.tenhou.bridge import TenhouBridge
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.logger import logger


class TenhouElectronClient(BaseElectronClient):
    def __init__(self, shared_queue: queue.Queue[dict]):
        super().__init__(shared_queue=shared_queue)
        try:
            self.bridge = TenhouBridge()
        except Exception as e:
            logger.error(f"Failed to initialize TenhouBridge in TenhouElectronClient: {e}")
            self.bridge = None

    WS_TEXT = 1
    WS_BINARY = 2

    def handle_message(self, message: dict):
        msg_type = message.get("type")

        if msg_type == "websocket_created":
            self._handle_websocket_created(message)
        elif msg_type == "websocket_closed":
            self._handle_websocket_closed(message)
        elif msg_type == "websocket":
            self._handle_websocket_frame(message)

    def _handle_websocket_created(self, message: dict):
        url = message.get("url", "")
        # Only track Tenhou related WebSockets
        if "tenhou.net" in url or "nodocchi" in url:
            with self._lock:
                self._active_connections += 1
                if self._active_connections == 1:
                    from akagi_ng.core import NotificationCode

                    self.message_queue.put({"type": "system_event", "code": NotificationCode.CLIENT_CONNECTED})
                    logger.info(f"[Electron] Tenhou client connected (first connection): {url}")

            if self.bridge:
                self.bridge.reset()

    def _handle_websocket_closed(self, message: dict):
        with self._lock:
            if self._active_connections <= 0:
                logger.warning("[Electron] Unexpected Tenhou websocket close event with no active connections")
                return

            self._active_connections -= 1
            if self._active_connections == 0:
                # Determine if we should send GAME_DISCONNECTED
                # If bridge indicates game ended, we assume RETURN_LOBBY was already sent via MJAI message.
                from akagi_ng.core import NotificationCode

                game_ended = getattr(self.bridge, "game_ended", False) if self.bridge else False

                if not game_ended:
                    self.message_queue.put({"type": "system_event", "code": NotificationCode.GAME_DISCONNECTED})
                    logger.info(
                        f"[Electron] All Tenhou connections closed, sending {NotificationCode.GAME_DISCONNECTED}"
                    )
                else:
                    logger.info(
                        "[Electron] All Tenhou connections closed after game end, suppressing GAME_DISCONNECTED."
                    )

    def _handle_websocket_frame(self, message: dict):
        if not self.bridge:
            return

        try:
            # We ONLY process inbound messages from the server to avoid double-counting
            # outbound actions (which will be echoed back as inbound confirmations).
            # direction 'outbound' in CDP corresponds to client -> server.
            # direction 'inbound' corresponds to server -> client.
            if message.get("direction") == "outbound":
                return

            data = message.get("data", "")
            if not data:
                return

            logger.trace(f"[Electron] -> Message: {data}")

            # Tenhou web client:
            # - Text frames (opcode 1): raw string (e.g. HELO)
            # - Binary frames (opcode 2): base64 encoded bytes
            opcode = message.get("opcode", self.WS_TEXT)

            if opcode == self.WS_BINARY:
                import base64

                raw_bytes = base64.b64decode(data)
            else:
                raw_bytes = data.encode("utf-8") if isinstance(data, str) else bytes(data)

            mjai_messages = self.bridge.parse(raw_bytes)

            if mjai_messages:
                logger.debug(f"[Tenhou] Decoded {len(mjai_messages)} MJAI messages")
                for msg in mjai_messages:
                    self.message_queue.put(msg)

                    # Check for game end to trigger notification
                    if msg.get("type") == "end_game":
                        from akagi_ng.core import NotificationCode

                        logger.info("[Electron] Detected end_game message in Tenhou, sending RETURN_LOBBY")
                        self.message_queue.put({"type": "system_event", "code": NotificationCode.RETURN_LOBBY})

        except Exception as e:
            logger.exception(f"Error decoding Tenhou websocket frame: {e}")
