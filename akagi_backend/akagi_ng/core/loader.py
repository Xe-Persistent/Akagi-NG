import importlib

from akagi_ng.core.logging import logger

logger = logger.bind(module="loader")


class ComponentLoader:
    def __init__(self):
        self.missing_resources: list[str] = []

    def load_bot_components(self) -> tuple[object, object] | tuple[None, None]:
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
        except ImportError:
            logger.error("Failed to load native library (libriichi).")
            return None, None

        try:
            from akagi_ng.mjai_bot import Controller, StateTrackerBot

            logger.info("Bot components loaded successfully.")
            return StateTrackerBot(), Controller()
        except ImportError as e:
            logger.error(f"Failed to load bot modules: {e}")
            return None, None
