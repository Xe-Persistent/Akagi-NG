import queue
import threading

from akagi_ng.core.constants import Platform
from akagi_ng.playwright_client.logger import logger
from akagi_ng.playwright_client.majsoul import MajsoulController
from akagi_ng.playwright_client.tenhou import TenhouController
from akagi_ng.settings import local_settings


class PlaywrightClient:
    def __init__(self, frontend_url: str):
        self.messages: queue.Queue[dict] | None = None
        self.running = False
        self._thread: threading.Thread | None = None

        if local_settings.browser.platform == Platform.TENHOU:
            self.controller = TenhouController(local_settings.browser.url, frontend_url)
        else:
            # Default to Majsoul
            self.controller = MajsoulController(local_settings.browser.url, frontend_url)

    def start(self):
        if self.running:
            return
        self.messages = self.controller.mjai_messages
        self._thread = threading.Thread(target=self.controller.start, daemon=True)
        self._thread.start()
        self.running = True

    def stop(self):
        if not self.running:
            return
        if not self.controller.running:
            return
        self.controller.stop()
        self.messages = None
        self.running = False
        self._thread.join()
        self._thread = None

    def send_command(self, command: dict):
        if not self.running:
            raise RuntimeError("Client is not running.")
        if not self.controller.running:
            raise RuntimeError("Controller is not running.")
        logger.debug(f"Sending command: {command}")
        self.controller.command_queue.put(command)

    def dump_messages(self) -> list[dict]:
        ans: list[dict] = []
        if self.messages is None:
            return ans
        while not self.messages.empty():
            message = self.messages.get()
            ans.append(message)
        return ans
