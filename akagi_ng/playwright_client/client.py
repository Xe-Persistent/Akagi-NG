import queue
import threading

from settings import local_settings
from .logger import logger
from .majsoul import PlaywrightController, mjai_messages


class Client(object):
    def __init__(self, frontend_url: str):
        self.messages: queue.Queue[dict] = None
        self.running = False
        self._thread: threading.Thread = None
        self.controller: PlaywrightController = PlaywrightController(local_settings.majsoul_url, frontend_url)

    def start(self):
        if self.running:
            return
        self.messages = mjai_messages
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
        while not self.messages.empty():
            message = self.messages.get()
            logger.debug(f"Message: {message}")
            ans.append(message)
        return ans
