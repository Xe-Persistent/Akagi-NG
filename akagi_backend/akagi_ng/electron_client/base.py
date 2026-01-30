from __future__ import annotations

import queue
from abc import ABC, abstractmethod

from akagi_ng.electron_client.logger import logger


class BaseElectronClient(ABC):
    def __init__(self):
        self.message_queue: queue.Queue[dict] = queue.Queue()
        self.running = False

    def start(self):
        self.running = True
        if hasattr(self, "bridge") and self.bridge:
            self.bridge.reset()
        logger.info(f"{self.__class__.__name__} started (waiting for input via API)")

    def stop(self):
        self.running = False
        logger.info(f"{self.__class__.__name__} stopped")

    def push_message(self, message: dict):
        """
        Process an incoming message from the Electron ingest API.
        This provides a base implementation that handles common message types.
        """
        if not self.running:
            return

        msg_type = message.get("type")

        # Handle common system events
        if msg_type in ("websocket_created", "websocket_closed"):
            logger.debug(f"[Electron] {msg_type}: {message.get('url', message.get('requestId'))}")
            return

        # Delegate to specialized handlers
        self.handle_message(message)

    @abstractmethod
    def handle_message(self, message: dict):
        """Handle platform-specific messages (abstract)"""
        pass

    def dump_messages(self) -> list[dict]:
        """Poll and return all pending MJAI messages."""
        ans: list[dict] = []
        if not self.running:
            return ans

        while not self.message_queue.empty():
            try:
                msg = self.message_queue.get_nowait()
                ans.append(msg)
            except queue.Empty:
                break
        return ans
