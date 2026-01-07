import contextlib
import signal
import threading
import time

from akagi_ng.core import context
from akagi_ng.core.logging import configure_logging, logger
from akagi_ng.dataserver.adapter import build_dataserver_payload
from akagi_ng.dataserver.dataserver import DataServer
from akagi_ng.playwright_client.client import PlaywrightClient
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


def verify_resources() -> list[str]:
    """
    Check if required resources (lib, models) exist.
    Returns a list of missing resource names.
    """
    missing = []

    # Check lib
    lib_dir = context.get_lib_dir()
    if not lib_dir.exists() or not any(lib_dir.iterdir()):
        missing.append("lib")

    # Check models
    models_dir = context.get_models_dir()
    if not models_dir.exists() or not any(models_dir.iterdir()):
        missing.append("models")

    return missing


class AkagiApp:
    def __init__(self):
        from akagi_ng import AKAGI_VERSION

        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")
        context.init_context()
        context.ensure_runtime_dirs()
        context.configure_playwright_env()
        context.settings = loaded_settings

        # Re-configure logger with settings
        configure_logging(context.settings.log_level)

        self._stop_event = threading.Event()

        # Start SSE DataServer for the standalone frontend
        port = context.settings.server.port
        host = context.settings.server.host
        self.ds = DataServer(external_port=port)

        # 0.0.0.0 is not a valid target address for browser navigation, map to localhost
        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        context.playwright_client = PlaywrightClient(frontend_url=self.frontend_url)

        # Verify resources before loading bot
        self.missing_resources = verify_resources()
        if self.missing_resources:
            logger.error(f"Missing resources: {self.missing_resources}")
            # Do NOT initialize mjai_bot or controller
            context.mjai_bot = None
            context.mjai_controller = None
        else:
            try:
                global AkagiBot, Controller
                from akagi_ng.mjai_bot.bot import AkagiBot
                from akagi_ng.mjai_bot.controller import Controller

                context.mjai_bot = AkagiBot()
                context.mjai_controller = Controller()
            except ImportError as e:
                logger.error(f"Failed to import mjai_bot: {e}")
                if "libriichi" in str(e):
                    self.missing_resources.append("lib")
                elif "models" in str(e):
                    self.missing_resources.append("models")

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        context.playwright_client.start()
        self.setup_signals()
        logger.info("Akagi backend loop started.")

        if self.missing_resources:
            threading.Thread(target=self._send_error_delayed, daemon=True).start()

    def _send_error_delayed(self):
        time.sleep(2.0)
        msg = f"{', '.join(self.missing_resources)}"
        self.ds.update_system_error("MISSING_RESOURCES", msg)

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
        # If resources missing, just run event loop to keep server alive
        if self.missing_resources:
            try:
                while not self._stop_event.is_set():
                    if not context.playwright_client.controller.running:
                        break
                    self._stop_event.wait(1.0)
            finally:
                self.cleanup()
            return 1

        try:
            while not self._stop_event.is_set():
                try:
                    # Check if the browser controller has stopped (e.g. frontend page closed)
                    if not context.playwright_client.controller.running:
                        logger.info("Playwright controller stopped. Exiting.")
                        break

                    mjai_msgs = context.playwright_client.dump_messages()
                    if not mjai_msgs:
                        self._stop_event.wait(0.05)
                        continue

                    for msg in mjai_msgs:
                        if context.mjai_controller:
                            mjai_response = context.mjai_controller.react(msg)
                        if context.mjai_bot:
                            context.mjai_bot.react(msg)

                        if context.mjai_bot:
                            payload = build_dataserver_payload(mjai_response, context.mjai_bot)
                            if payload:
                                self.ds.update_data({"data": payload})

                except Exception as e:
                    logger.exception(f"Critical error in main loop: {e}")
                    # Brief pause to prevent tight loop if error is persistent
                    self._stop_event.wait(1.0)

        finally:
            self.cleanup()

        return 0

    def cleanup(self):
        logger.info("Stopping Akagi-NG...")
        with contextlib.suppress(Exception):
            context.playwright_client.stop()
        with contextlib.suppress(Exception):
            self.ds.stop()
        logger.info("Akagi-NG stopped.")
