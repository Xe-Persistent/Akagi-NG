import signal
import sys

from core import context
from core.frontend_adapter import build_dataserver_payload
from core.logging import logger
from dataserver.dataserver import DataServer
from mjai_bot.bot import AkagiBot
from mjai_bot.controller import Controller
from playwright_client.client import Client
from settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")

import threading


def main() -> int:
    app = AkagiApp()
    app.start()
    return app.run()


class AkagiApp:
    def __init__(self):
        logger.info("Starting Akagi...")
        context.ensure_runtime_dirs()
        context.settings = loaded_settings

        # Re-configure logger with settings
        from core.logging import configure_logging
        configure_logging(context.settings.log_level)

        self._stop_event = threading.Event()

        # Start SSE DataServer for the standalone frontend
        port = context.settings.server.port
        host = context.settings.server.host
        self.ds = DataServer(external_port=port)

        # 0.0.0.0 is not a valid target address for browser navigation, map to localhost
        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        context.playwright_client = Client(frontend_url=self.frontend_url)
        context.mjai_bot = AkagiBot()
        context.mjai_controller = Controller()

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        context.playwright_client.start()
        self.setup_signals()
        logger.info("Akagi backend loop started.")

    def setup_signals(self):
        def _stop(*_args):
            self.stop()

        signal.signal(signal.SIGINT, _stop)
        try:
            signal.signal(signal.SIGTERM, _stop)
        except Exception as e:
            logger.debug(f"Failed to setup SIGTERM handler: {e}")

    def stop(self):
        self._stop_event.set()

    def run(self) -> int:
        try:
            while not self._stop_event.is_set():
                # Check if the browser controller has stopped (e.g. frontend page closed)
                if not context.playwright_client.controller.running:
                    logger.info("Playwright controller stopped. Exiting.")
                    break

                mjai_msgs = context.playwright_client.dump_messages()
                if not mjai_msgs:
                    self._stop_event.wait(0.05)
                    continue

                for msg in mjai_msgs:
                    mjai_response = context.mjai_controller.react(msg)
                    context.mjai_bot.react(msg)

                    payload = build_dataserver_payload(mjai_response, context.mjai_bot)
                    if payload:
                        self.ds.update_data({"data": payload})

        except Exception as e:
            logger.exception(f"Backend loop crashed: {e}")
            return 1
        finally:
            self.cleanup()

        return 0

    def cleanup(self):
        logger.info("Stopping Akagi...")
        try:
            context.playwright_client.stop()
        except Exception:
            pass
        try:
            self.ds.stop()
        except Exception:
            pass
        logger.info("Akagi stopped.")


if __name__ == "__main__":
    sys.exit(main())
