import threading
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import numpy as np

from akagi_ng.core.paths import get_models_dir
from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.mortal import load_local_mortal_engine
from akagi_ng.mjai_bot.engine.replay import ReplayEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.protocols import Bot
from akagi_ng.settings import local_settings

# 全局引擎缓存，避免重复加载数百 MB 的模型文件
type CacheKey = tuple[str | bool, ...]
_ENGINE_CACHE: dict[CacheKey, BaseEngine] = {}
_CACHE_LOCK = threading.Lock()


class LazyMortalEngine(BaseEngine):
    """
    延迟加载的本地 Mortal 引擎包装器。
    仅在真正需要推理（如在线引擎失败）时才触发磁盘加载和预热。
    """

    def __init__(self, model_path: Path, consts: ModuleType, is_3p: bool):
        super().__init__(is_3p=is_3p, version=4, name="mortal_lazy")
        self.model_path = model_path
        self.consts = consts
        self._real_engine: BaseEngine | None = None

    def _ensure_engine(self) -> BaseEngine:
        if self._real_engine is None:
            logger.info("LazyMortalEngine: Materializing real engine (disk IO)...")
            self._real_engine = load_local_mortal_engine(self.model_path, self.consts, self.is_3p)
            if not self._real_engine:
                raise RuntimeError(f"Failed to load local model at {self.model_path}")
        return self._real_engine

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        return self._ensure_engine().react_batch(obs, masks, invisible_obs)

    @property
    def engine_type(self) -> str:
        return "mortal"

    def __getattr__(self, name: str) -> object:
        # 委托所有其他属性（如 is_replaying, last_inference_result）给真实引擎
        if name in ("_real_engine", "_factory", "_ensure_engine"):
            return super().__getattribute__(name)
        return getattr(self._ensure_engine(), name)


def get_cached_engine(key: CacheKey, factory: Callable[[], BaseEngine]) -> BaseEngine:
    with _CACHE_LOCK:
        if key not in _ENGINE_CACHE:
            _ENGINE_CACHE[key] = factory()
        return _ENGINE_CACHE[key]


def load_model(seat: int, is_3p: bool) -> tuple[Bot, BaseEngine]:
    """
    Mortal 统一加载器（支持缓存与延迟加载）。
    """
    if is_3p:
        from akagi_ng.core.lib_loader import libriichi3p as libriichi

        model_filename = "mortal3p.pth"
    else:
        from akagi_ng.core.lib_loader import libriichi

        model_filename = "mortal.pth"

    consts = libriichi.consts
    control_state_file = get_models_dir() / model_filename
    is_online = local_settings.ot.online

    # 构造复合缓存键
    if is_online:
        cache_key = ("akagiot", is_3p, local_settings.ot.server, local_settings.ot.api_key)
    else:
        cache_key = ("mortal", is_3p, str(control_state_file))

    with _CACHE_LOCK:
        if cache_key not in _ENGINE_CACHE:
            if is_online:
                logger.info(f"Initializing AkagiOTEngine ({'3P' if is_3p else '4P'}) with Lazy Fallback.")
                # 在线模式下，回退引擎使用延迟加载包装器
                fallback = LazyMortalEngine(control_state_file, consts, is_3p)
                real_engine = AkagiOTEngine(
                    is_3p=is_3p,
                    url=local_settings.ot.server,
                    api_key=local_settings.ot.api_key,
                    fallback_engine=fallback,
                )
            else:
                logger.info(f"Loading local Mortal ({'3P' if is_3p else '4P'}) for the first time.")
                real_engine = load_local_mortal_engine(control_state_file, consts=consts, is_3p=is_3p)
                if not real_engine:
                    raise FileNotFoundError(f"Model file not found at {control_state_file}")

            _ENGINE_CACHE[cache_key] = real_engine
        else:
            real_engine = _ENGINE_CACHE[cache_key]

    # 关键：从缓存获取后，重置每一局游戏的公共状态
    real_engine.is_replaying = False
    real_engine.last_inference_result = None

    proxy_engine = ReplayEngine(real_engine)
    bot = libriichi.mjai.Bot(proxy_engine, seat)
    return bot, proxy_engine
