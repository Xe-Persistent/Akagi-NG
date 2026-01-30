from __future__ import annotations

from akagi_ng.bridge.tenhou.bridge import TenhouBridge
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.logger import logger


class TenhouElectronClient(BaseElectronClient):
    def __init__(self):
        super().__init__()
        try:
            self.bridge = TenhouBridge()
        except Exception as e:
            logger.error(f"Failed to initialize TenhouBridge in TenhouElectronClient: {e}")
            self.bridge = None

    WS_TEXT = 1
    WS_BINARY = 2

    def handle_message(self, message: dict):
        msg_type = message.get("type")

        if msg_type == "websocket":
            self._handle_websocket_frame(message)
        elif msg_type == "websocket_created":
            logger.info("[Tenhou] New websocket connection detected. Resetting bridge state.")
            if self.bridge:
                self.bridge.reset()

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

        except Exception as e:
            logger.exception(f"Error decoding Tenhou websocket frame: {e}")
