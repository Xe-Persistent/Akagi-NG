from __future__ import annotations

import queue
import threading
from abc import ABC, abstractmethod

from akagi_ng.electron_client.logger import logger


class BaseElectronClient(ABC):
    def __init__(self, shared_queue: queue.Queue[dict]):
        self.message_queue: queue.Queue[dict] = shared_queue
        self.running = False
        self._active_connections = 0
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            self.running = True
            self._active_connections = 0
            if hasattr(self, "bridge") and self.bridge:
                self.bridge.reset()
            logger.info(f"{self.__class__.__name__} started.")

    def stop(self):
        with self._lock:
            self.running = False
            self._active_connections = 0
            logger.info(f"{self.__class__.__name__} stopped.")

    def push_message(self, message: dict):
        """
        Process an incoming message from the Electron ingest API.
        This provides a base implementation that handles common message types.
        """
        if not self.running:
            return

        # Handle global debugger detachment
        if message.get("type") == "debugger_detached":
            self._handle_debugger_detached(message)
            return

        # Delegate all messages including websocket lifecycle to specialized handlers
        self.handle_message(message)

    def _handle_debugger_detached(self, message: dict):
        """
        Handle the event when the Electron debugger detaches (e.g. window closed).
        This forces reset of connection counts and sends disconnect notifications.
        """
        with self._lock:
            if self._active_connections > 0:
                logger.info(
                    f"[{self.__class__.__name__}] Debugger detached, forcing disconnect."
                    f"(Active: {self._active_connections})"
                )
                self._active_connections = 0

                from akagi_ng.core import NotificationCode

                # Determine if we should send GAME_DISCONNECTED
                # If bridge indicates game ended, we assume RETURN_LOBBY was already sent via MJAI message,
                # so we verify and suppress the disconnection error.
                game_ended = False
                if hasattr(self, "bridge") and self.bridge:
                    game_ended = getattr(self.bridge, "game_ended", False)

                if not game_ended:
                    self.message_queue.put({"type": "system_event", "code": NotificationCode.GAME_DISCONNECTED})
                else:
                    logger.info(
                        f"[{self.__class__.__name__}] Debugger detached after game end, suppressing GAME_DISCONNECTED."
                    )
            else:
                logger.debug(f"[{self.__class__.__name__}] Debugger detached, no active connections.")

    @abstractmethod
    def handle_message(self, message: dict):
        """Handle platform-specific messages (abstract)"""
        pass
