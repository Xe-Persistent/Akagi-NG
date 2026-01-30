from __future__ import annotations

import base64
import json

from akagi_ng.bridge.majsoul.bridge import MajsoulBridge
from akagi_ng.core.paths import get_assets_dir
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.logger import logger


class MajsoulElectronClient(BaseElectronClient):
    def __init__(self):
        super().__init__()
        try:
            self.bridge = MajsoulBridge()
        except Exception as e:
            logger.error(f"Failed to initialize MajsoulBridge in MajsoulElectronClient: {e}")
            self.bridge = None

    def handle_message(self, message: dict):
        msg_type = message.get("type")

        if msg_type == "liqi_definition":
            self._handle_liqi_definition(message)
        elif msg_type == "websocket":
            self._handle_websocket_frame(message)

    def _handle_liqi_definition(self, message: dict):
        try:
            data = message.get("data", "")
            if not data:
                return

            logger.info("Received liqi.json definition, updating...")
            liqi_path = get_assets_dir() / "liqi.json"

            try:
                json_obj = json.loads(data)
                with open(liqi_path, "w", encoding="utf-8") as f:
                    json.dump(json_obj, f, indent=2, ensure_ascii=False)

                if self.bridge:
                    # Re-init proto
                    self.bridge.liqi_proto = self.bridge.liqi_proto.__class__()
            except json.JSONDecodeError:
                logger.warning("Received invalid JSON for liqi.json")

        except Exception as e:
            logger.error(f"Failed to update liqi.json: {e}")

    def _handle_websocket_frame(self, message: dict):
        if not self.bridge:
            return

        try:
            b64_data = message.get("data", "")
            if not b64_data:
                return

            direction = "<-" if message.get("direction") == "outbound" else "->"
            logger.trace(f"[Electron] {direction} Message: {b64_data}")

            # Majsoul messages are always binary (opcode 2) and sent as base64 in CDP
            raw_bytes = base64.b64decode(b64_data)
            mjai_messages = self.bridge.parse(raw_bytes)

            if mjai_messages:
                logger.debug(f"[Majsoul] Decoded {len(mjai_messages)} MJAI messages")
                for msg in mjai_messages:
                    self.message_queue.put(msg)

        except Exception as e:
            logger.exception(f"Error decoding Majsoul websocket frame: {e}")
