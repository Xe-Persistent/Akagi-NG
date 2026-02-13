import threading
from pathlib import Path
from types import ModuleType
from typing import Any, Self

import numpy as np

from akagi_ng.core.paths import get_models_dir
from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTClient, AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.mortal import (
    MortalEngine,
    MortalModelResource,
    load_mortal_resource,
)
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.protocols import BotProtocol, EngineProtocol
from akagi_ng.settings import local_settings

# 资源缓存
# Key: (is_3p, server_url) for Network / (model_path) for Model
_RESOURCE_CACHE: dict[Any, Any] = {}
_CACHE_LOCK = threading.Lock()


class NullEngine(BaseEngine):
    """
    空引擎 - 在所有引擎都不可用时提供兜底。
    返回第一个合法动作，并通过 notification_flags 告知前端引擎不可用。
    """

    def __init__(self, status: BotStatusContext, is_3p: bool):
        super().__init__(status=status, is_3p=is_3p, version=4, name="NullEngine", is_oracle=False)
        self.engine_type = "null"

    def fork(self, status: BotStatusContext | None = None) -> Self:
        return NullEngine(status or self.status, self.is_3p)

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        # 使用基类的 _sync_fast_forward 返回第一个合法动作
        return self._sync_fast_forward(np.asanyarray(masks))


class LazyLocalEngine(BaseEngine):
    """
    轻量级延迟加载引擎。
    仅在第一次调用 react_batch 时从全局缓存加载资源并创建 MortalEngine。
    """

    def __init__(self, status: BotStatusContext, model_path: Path, consts: ModuleType, is_3p: bool):
        super().__init__(status=status, is_3p=is_3p, version=4, name="Mortal(Lazy)", is_oracle=False)
        self.model_path = model_path
        self.consts = consts
        self.engine_type = "mortal"
        self._real_engine: BaseEngine | None = None
        self._load_failed = False

    def fork(self, status: BotStatusContext | None = None) -> Self:
        return LazyLocalEngine(status or self.status, self.model_path, self.consts, self.is_3p)

    def _ensure_engine(self) -> BaseEngine:
        if self._real_engine is None and not self._load_failed:
            # 尝试从全局资源缓存获取或加载
            resource = _get_or_load_model_resource(self.model_path, self.consts, self.is_3p)

            if resource:
                self._real_engine = MortalEngine(self.status, resource, self.is_3p)
            else:
                logger.error(f"Failed to load local model at {self.model_path}. Using NullEngine as fallback.")
                self._load_failed = True
                self.engine_type = "null"
                self._real_engine = NullEngine(self.status, self.is_3p)

        return self._real_engine

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        real_engine = self._ensure_engine()
        return real_engine.react_batch(obs, masks, invisible_obs, is_sync=is_sync)


def _get_or_load_model_resource(model_path: Path, consts: ModuleType, is_3p: bool) -> MortalModelResource | None:
    """Helper to manage ModelResource cache"""
    cache_key = f"model:{model_path}"
    with _CACHE_LOCK:
        if cache_key not in _RESOURCE_CACHE:
            logger.info("Factory: Loading model resource from disk...")
            resource = load_mortal_resource(model_path, consts, is_3p)
            if resource:
                _RESOURCE_CACHE[cache_key] = resource
            else:
                return None
        return _RESOURCE_CACHE[cache_key]


def _get_or_create_ot_client(url: str, api_key: str) -> AkagiOTClient:
    """Helper to manage AkagiOTClient cache"""
    cache_key = f"network:{url}"
    with _CACHE_LOCK:
        if cache_key not in _RESOURCE_CACHE:
            logger.debug(f"Factory: Creating new AkagiOTClient for {url}")
            _RESOURCE_CACHE[cache_key] = AkagiOTClient(url, api_key)
        return _RESOURCE_CACHE[cache_key]


def load_bot_and_engine(
    status: BotStatusContext, player_id: int, is_3p: bool = False
) -> tuple[BotProtocol, EngineProtocol]:
    """加载引擎的统一入口"""
    if is_3p:
        from akagi_ng.core.lib_loader import libriichi3p as libriichi

        model_filename = local_settings.model_config.model_3p
    else:
        from akagi_ng.core.lib_loader import libriichi

        model_filename = local_settings.model_config.model_4p

    consts = libriichi.consts
    model_path = get_models_dir() / model_filename

    # 1. 准备 Lazy Local Engine (持有资源引用，按需加载)
    local_engine = LazyLocalEngine(status, model_path, consts, is_3p)

    # 2. 准备 Online Engine (如果启用)
    online_engine = None
    if local_settings.ot.online:
        client = _get_or_create_ot_client(local_settings.ot.server, local_settings.ot.api_key)
        # 创建全新的 Engine 实例，共享 client
        online_engine = AkagiOTEngine(status, is_3p, client)

    # 3. 组装 Provider (全新的实例)
    provider = EngineProvider(status, online_engine, local_engine, is_3p)

    bot = libriichi.mjai.Bot(provider, player_id)
    # 注入 status 到 bot (对于 libriichi.mjai.Bot 可能需要手动注入或者它不关心但符合协议)
    if hasattr(bot, "status"):
        bot.status = status

    return bot, provider
