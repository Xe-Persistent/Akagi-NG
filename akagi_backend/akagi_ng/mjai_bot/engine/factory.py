import threading
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np

from akagi_ng.core.paths import get_models_dir
from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.mortal import load_local_mortal_engine
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.protocols import Bot
from akagi_ng.settings import local_settings

# 全局引擎缓存
_ENGINE_CACHE: dict[tuple[Any, ...], BaseEngine] = {}
_CACHE_LOCK = threading.Lock()


class LazyLocalEngine(BaseEngine):
    """
    轻量级延迟加载引擎。
    仅在第一次调用 react_batch 时加载真实的本地模型。
    不使用 __getattr__ 代理，而是通过显式委托实现。
    """

    def __init__(self, model_path: Path, consts: ModuleType, is_3p: bool):
        super().__init__(is_3p=is_3p, version=4, name="Mortal(Lazy)", is_oracle=False)
        self.model_path = model_path
        self.consts = consts
        self.engine_type = "mortal"
        self._real_engine: BaseEngine | None = None

    def _ensure_engine(self) -> BaseEngine:
        if self._real_engine is None:
            logger.info("LazyLocalEngine: Loading real model from disk...")
            self._real_engine = load_local_mortal_engine(self.model_path, self.consts, self.is_3p)
            if not self._real_engine:
                raise RuntimeError(f"Failed to load local model at {self.model_path}")
            # 同步模式应在加载后继承
            self._real_engine.set_sync_mode(self.is_sync_mode)
        return self._real_engine

    def set_sync_mode(self, enabled: bool):
        super().set_sync_mode(enabled)
        if self._real_engine:
            self._real_engine.set_sync_mode(enabled)

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        return self._ensure_engine().react_batch(obs, masks, invisible_obs)

    def get_notification_flags(self) -> dict[str, Any]:
        if self._real_engine is None:
            return {}
        return self._real_engine.get_notification_flags()

    def get_additional_meta(self) -> dict[str, Any]:
        if self._real_engine is None:
            return {}
        return self._real_engine.get_additional_meta()


def load_bot_and_engine(seat: int, is_3p: bool) -> tuple[Bot, BaseEngine]:
    """加载引擎的统一入口"""
    if is_3p:
        from akagi_ng.core.lib_loader import libriichi3p as libriichi

        model_filename = "mortal3p.pth"
    else:
        from akagi_ng.core.lib_loader import libriichi

        model_filename = "mortal.pth"

    consts = libriichi.consts
    model_path = get_models_dir() / model_filename

    # 构造 Provider
    with _CACHE_LOCK:
        cache_key = (is_3p, local_settings.ot.online, local_settings.ot.server)
        if cache_key not in _ENGINE_CACHE:
            local_engine = LazyLocalEngine(model_path, consts, is_3p)

            online_engine = None
            if local_settings.ot.online:
                online_engine = AkagiOTEngine(
                    is_3p=is_3p, url=local_settings.ot.server, api_key=local_settings.ot.api_key
                )

            # 使用 EngineProvider 汇总
            provider = EngineProvider(online_engine, local_engine, is_3p)
            _ENGINE_CACHE[cache_key] = provider

        engine = _ENGINE_CACHE[cache_key]

    # 清理旧的局状态信息
    engine.last_inference_result = None

    bot = libriichi.mjai.Bot(engine, seat)
    return bot, engine
