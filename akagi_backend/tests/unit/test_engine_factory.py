"""
测试模块：akagi_backend/tests/unit/test_engine_factory.py

描述：针对引擎工厂 (Engine Factory) 和延迟加载机制的单元测试。
主要测试点：
- 延迟加载引擎 (LazyLocalEngine) 的初始化、代理和按需加载逻辑。
- 根据 3P/4P 配置加载对应的 Bot 和引擎实例。
- 根据在线/本地配置加载 EngineProvider 及其组合逻辑。
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.engine.factory import _RESOURCE_CACHE, LazyLocalEngine, load_bot_and_engine
from akagi_ng.mjai_bot.status import BotStatusContext

# 自动应用 mock_lib_loader_module fixture（定义在 unit/conftest.py 中）
pytestmark = pytest.mark.usefixtures("mock_lib_loader_module")


@pytest.fixture(autouse=True)
def clear_cache():
    """每个测试前清理缓存。"""
    _RESOURCE_CACHE.clear()


@pytest.fixture
def mock_consts():
    return MagicMock()


def test_lazy_local_engine_init(mock_consts) -> None:
    """测试延迟加载引擎的初始化。"""
    path = Path("mortal.pth")
    engine = LazyLocalEngine(BotStatusContext(), path, mock_consts, is_3p=False)
    assert engine.name == "Local"
    assert engine._real_engine is None


def test_lazy_local_engine_ensure_engine(mock_consts) -> None:
    """测试延迟加载引擎的真实加载。"""
    path = Path("mortal.pth")
    engine = LazyLocalEngine(BotStatusContext(), path, mock_consts, is_3p=False)

    mock_mortal = MagicMock()
    with patch.dict(sys.modules, {"akagi_ng.mjai_bot.engine.mortal": mock_mortal}):
        mock_resource = MagicMock()
        mock_mortal.load_mortal_resource.return_value = mock_resource
        mock_mortal.MortalEngine.return_value = MagicMock()

        # 第一次触发加载
        real = engine._ensure_engine()
        assert real is not None
        mock_mortal.load_mortal_resource.assert_called_once()


def test_lazy_local_engine_delegation(mock_consts) -> None:
    """测试延迟加载引擎的状态代理。"""
    status = BotStatusContext()
    engine = LazyLocalEngine(status, Path("mortal.pth"), mock_consts, is_3p=False)
    mock_real = MagicMock()
    mock_real.status = status
    engine._real_engine = mock_real

    # LazyLocalEngine 通过 BaseEngine 继承持有相同 status
    assert engine.status == status


def test_load_bot_and_engine_4p(mock_lib_loader_module) -> None:
    """测试加载 4 人麻将引擎和 Bot。"""
    with patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings:
        mock_settings.ot.online = False
        mock_settings.model_config.model_4p = "mortal_4p.pth"

        # Setup mock
        mock_lib_loader_module.libriichi.mjai.Bot = MagicMock()

        bot, engine = load_bot_and_engine(BotStatusContext(), player_id=0, is_3p=False)

        assert bot is not None
        assert engine is not None


def test_load_bot_and_engine_3p(mock_lib_loader_module) -> None:
    """测试加载 3 人麻将引擎和 Bot。"""
    with patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings:
        mock_settings.ot.online = False
        mock_settings.model_config.model_3p = "mortal_3p.pth"

        mock_lib_loader_module.libriichi3p.mjai.Bot = MagicMock()

        bot, engine = load_bot_and_engine(BotStatusContext(), player_id=1, is_3p=True)

        assert bot is not None
        assert engine.is_3p is True


def test_v3_online_api_stays_above_tensor_engine(mock_lib_loader_module) -> None:
    """V3 API returns MJAI actions, so the tensor provider remains local."""
    with patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings:
        mock_settings.model_config.model_4p = "mortal_4p.pth"

        mock_lib_loader_module.libriichi.mjai.Bot = MagicMock()

        _, engine = load_bot_and_engine(BotStatusContext(), player_id=0, is_3p=False)

        assert engine.name.startswith("Provider")
        assert engine.online_engine is None
