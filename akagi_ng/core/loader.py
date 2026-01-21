import importlib
from collections.abc import Callable
from pathlib import Path

from akagi_ng.core.logging import logger
from akagi_ng.core.paths import get_lib_dir, get_models_dir

logger = logger.bind(module="loader")


class ComponentLoader:
    def __init__(self):
        self.missing_resources: list[str] = []

    def check_directory(self, path_getter: Callable[[], Path], resource_name: str) -> bool:
        """检查目录是否存在且非空"""
        directory = path_getter()
        if not directory.exists() or not any(directory.iterdir()):
            self.missing_resources.append(resource_name)
            return False
        return True

    def load_bot_components(self) -> tuple[object, object] | tuple[None, None]:
        """如果资源可用则加载 bot/controller"""
        # 1. 检查必需目录: lib
        if not self.check_directory(get_lib_dir, "lib"):
            return None, None

        # 2. 尝试加载原生库 (lib_loader)
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
        except ImportError:
            self.missing_resources.append("lib")
            return None, None

        # 3. 检查必需目录: models
        if not self.check_directory(get_models_dir, "models"):
            return None, None

        # 4. 加载 bot 模块
        try:
            # 使用 importlib 或者是直接 import
            from akagi_ng.mjai_bot import Controller, StateTrackerBot

            logger.info("Bot components loaded successfully.")
            return StateTrackerBot(), Controller()
        except ImportError as e:
            logger.error(f"Failed to load bot modules: {e}")
            self.missing_resources.append("bot")
            return None, None
