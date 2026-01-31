from __future__ import annotations

import base64
import json
import queue

from akagi_ng.bridge.majsoul.bridge import MajsoulBridge
from akagi_ng.core.paths import ensure_dir, get_assets_dir
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.logger import logger


class MajsoulElectronClient(BaseElectronClient):
    def __init__(self, shared_queue: queue.Queue[dict]):
        super().__init__(shared_queue=shared_queue)
        try:
            self.bridge = MajsoulBridge()
        except Exception as e:
            logger.error(f"Failed to initialize MajsoulBridge in MajsoulElectronClient: {e}")
            self.bridge = None

    def handle_message(self, message: dict):
        msg_type = message.get("type")

        if msg_type == "websocket_created":
            self._handle_websocket_created(message)
        elif msg_type == "websocket_closed":
            self._handle_websocket_closed(message)
        elif msg_type == "liqi_definition":
            self._handle_liqi_definition(message)
        elif msg_type == "websocket":
            self._handle_websocket_frame(message)

    def _handle_websocket_created(self, message: dict):
        url = message.get("url", "")
        # Track Majsoul related WebSockets (including regional variants like mahjongsoul, maj-soul)
        if any(keyword in url for keyword in ["maj-soul", "mahjongsoul", "majsoul"]):
            with self._lock:
                self._active_connections += 1
                if self._active_connections == 1:
                    from akagi_ng.core import NotificationCode

                    self.message_queue.put({"type": "system_event", "code": NotificationCode.CLIENT_CONNECTED})
                    logger.info(f"[Electron] Majsoul client connected (first connection): {url}")
        else:
            logger.debug(f"[Electron] Ignoring non-Majsoul WebSocket: {url}")

    def _handle_websocket_closed(self, message: dict):
        # We don't have URL in closed event in CDP usually, but we track count
        with self._lock:
            if self._active_connections <= 0:
                logger.warning("[Electron] Unexpected websocket close event with no active connections")
                return

            self._active_connections -= 1
            if self._active_connections == 0:
                # Determine if we should send GAME_DISCONNECTED
                # If bridge indicates game ended, we assume RETURN_LOBBY was already sent via MJAI message.
                game_ended = getattr(self.bridge, "game_ended", False) if self.bridge else False

                if not game_ended:
                    from akagi_ng.core import NotificationCode

                    self.message_queue.put({"type": "system_event", "code": NotificationCode.GAME_DISCONNECTED})
                    logger.info(
                        f"[Electron] All Majsoul connections closed, sending {NotificationCode.GAME_DISCONNECTED}"
                    )
                else:
                    logger.info(
                        "[Electron] All Majsoul connections closed after game end, suppressing GAME_DISCONNECTED."
                    )

    def _handle_liqi_definition(self, message: dict):
        from akagi_ng.core import NotificationCode

        try:
            data = message.get("data", "")
            if not data:
                return

            logger.info("Received liqi.json definition, updating...")

            try:
                # 1. Validate JSON first
                json_obj = json.loads(data)

                # 2. Ensure directory exists
                assets_dir = get_assets_dir()
                ensure_dir(assets_dir)
                liqi_path = assets_dir / "liqi.json"

                # 3. Write file
                with open(liqi_path, "w", encoding="utf-8") as f:
                    json.dump(json_obj, f, indent=2, ensure_ascii=False)

                # 4. Success handling
                if self.bridge:
                    # Re-init proto in bridge
                    self.bridge.liqi_proto = self.bridge.liqi_proto.__class__()

                self.message_queue.put({"type": "system_event", "code": NotificationCode.MAJSOUL_PROTO_UPDATED})
                logger.info(f"Successfully updated liqi.json at {liqi_path}")

            except json.JSONDecodeError:
                logger.warning("Received invalid JSON for liqi.json")
                self.message_queue.put({"type": "system_event", "code": NotificationCode.MAJSOUL_PROTO_UPDATE_FAILED})
            except OSError as e:
                logger.error(f"File system error updating liqi.json: {e}")
                self.message_queue.put({"type": "system_event", "code": NotificationCode.MAJSOUL_PROTO_UPDATE_FAILED})

        except Exception as e:
            logger.error(f"Unexpected error in handle liqi definition: {e}")
            self.message_queue.put({"type": "system_event", "code": NotificationCode.MAJSOUL_PROTO_UPDATE_FAILED})

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
            try:
                raw_bytes = base64.b64decode(b64_data)
            except Exception as e:
                logger.error(f"Failed to decode base64 websocket data: {e}")
                return

            mjai_messages = self.bridge.parse(raw_bytes)

            if mjai_messages:
                logger.debug(f"[Majsoul] Decoded {len(mjai_messages)} MJAI messages")
                for msg in mjai_messages:
                    self.message_queue.put(msg)

                    # Check for game end to trigger notification
                    if msg.get("type") == "end_game":
                        from akagi_ng.core import NotificationCode

                        logger.info("[Electron] Detected end_game message, sending RETURN_LOBBY")
                        self.message_queue.put({"type": "system_event", "code": NotificationCode.RETURN_LOBBY})

        except Exception as e:
            logger.exception(f"Error decoding Majsoul websocket frame: {e}")
