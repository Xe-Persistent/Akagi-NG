import signal
import sys
import time

from core import context
from core.frontend_adapter import build_dataserver_payload
from core.logging import logger
from dataserver.dataserver import DataServer
from mjai_bot.bot import AkagiBot
from mjai_bot.controller import Controller
from playwright_client.client import Client
from settings.settings import settings as loaded_settings

logger = logger.bind(module="akagi")


def main() -> int:
    logger.info("Starting Akagi...")

    context.ensure_runtime_dirs()

    context.settings = loaded_settings

    # Start SSE DataServer for the standalone frontend
    ds = DataServer(external_port=8765)
    ds.start()
    frontend_url = "http://127.0.0.1:8765/"
    logger.info(f"DataServer started at {frontend_url}")

    context.playwright_client = Client(frontend_url=frontend_url)
    context.mjai_bot = AkagiBot()
    context.mjai_controller = Controller()
    context.playwright_client.start()

    stop_flag = {"stop": False}

    def _stop(*_args):
        stop_flag["stop"] = True

    signal.signal(signal.SIGINT, _stop)
    try:
        signal.signal(signal.SIGTERM, _stop)
    except Exception:
        pass

    logger.info("Akagi backend loop started.")

    try:
        while not stop_flag["stop"]:
            # Check if the browser controller has stopped (e.g. frontend page closed)
            if not context.playwright_client.controller.running:
                logger.info("Playwright controller stopped. Exiting.")
                break

            mjai_msgs = context.playwright_client.dump_messages()
            if not mjai_msgs:
                time.sleep(0.05)
                continue

            for msg in mjai_msgs:
                mjai_response = context.mjai_controller.react(msg)
                context.mjai_bot.react(msg)

                payload = build_dataserver_payload(mjai_response, context.mjai_bot)
                if payload:
                    ds.update_data({"data": payload})

    except Exception as e:
        logger.exception(f"Backend loop crashed: {e}")
        return 1
    finally:
        logger.info("Stopping Akagi...")
        try:
            context.playwright_client.stop()
        except Exception:
            pass
        try:
            ds.stop()
        except Exception:
            pass

    logger.info("Akagi stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
