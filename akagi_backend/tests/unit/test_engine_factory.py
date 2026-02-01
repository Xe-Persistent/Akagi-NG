from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.engine.factory import _ENGINE_CACHE, LazyLocalEngine, load_bot_and_engine


@pytest.fixture(autouse=True)
def clear_cache():
    """每个测试前清理缓存。"""
    _ENGINE_CACHE.clear()


@pytest.fixture
def mock_consts():
    return MagicMock()


def test_lazy_local_engine_init(mock_consts) -> None:
    """测试延迟加载引擎的初始化。"""
    path = Path("mortal.pth")
    engine = LazyLocalEngine(path, mock_consts, is_3p=False)
    assert engine.name == "Mortal(Lazy)"
    assert engine._real_engine is None


def test_lazy_local_engine_ensure_engine(mock_consts) -> None:
    """测试延迟加载引擎的真实加载。"""
    path = Path("mortal.pth")
    engine = LazyLocalEngine(path, mock_consts, is_3p=False)

    with patch("akagi_ng.mjai_bot.engine.factory.load_local_mortal_engine") as mock_load:
        mock_real = MagicMock()
        mock_load.return_value = mock_real

        # 第一次触发加载
        real = engine._ensure_engine()
        assert real == mock_real
        mock_load.assert_called_once()

        # 第二次不再加载
        real2 = engine._ensure_engine()
        assert real2 == mock_real
        assert mock_load.call_count == 1


def test_lazy_local_engine_delegation(mock_consts) -> None:
    """测试延迟加载引擎的方法委托。"""
    engine = LazyLocalEngine(Path("mortal.pth"), mock_consts, is_3p=False)
    mock_real = MagicMock()
    engine._real_engine = mock_real

    # 测试属性和方法的转发
    engine.get_notification_flags()
    assert mock_real.get_notification_flags.called

    engine.get_additional_meta()
    assert mock_real.get_additional_meta.called


def test_load_bot_and_engine_4p() -> None:
    """测试加载 4 人麻将引擎和机器人。"""
    with (
        patch("akagi_ng.core.lib_loader.libriichi") as mock_lib,
        patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings,
    ):
        mock_settings.ot.online = False
        mock_lib.mjai.Bot = MagicMock()

        bot, engine = load_bot_and_engine(seat=0, is_3p=False)

        assert bot is not None
        assert engine is not None
        # 应包含在缓存中
        assert len(_ENGINE_CACHE) == 1


def test_load_bot_and_engine_3p() -> None:
    """测试加载 3 人麻将引擎和机器人。"""
    with (
        patch("akagi_ng.core.lib_loader.libriichi3p") as mock_lib,
        patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings,
    ):
        mock_settings.ot.online = False
        mock_lib.mjai.Bot = MagicMock()

        bot, engine = load_bot_and_engine(seat=1, is_3p=True)

        assert bot is not None
        assert engine.is_3p is True


def test_load_bot_and_engine_online() -> None:
    """测试加载包含在线引擎的 Provider。"""
    with (
        patch("akagi_ng.core.lib_loader.libriichi") as mock_lib,
        patch("akagi_ng.mjai_bot.engine.factory.local_settings") as mock_settings,
        patch("akagi_ng.mjai_bot.engine.factory.AkagiOTEngine") as mock_ot,
    ):
        mock_settings.ot.online = True
        mock_settings.ot.server = "http://localhost"
        mock_settings.ot.api_key = "key"

        bot, engine = load_bot_and_engine(seat=0, is_3p=False)

        # 应该创建了 AkagiOTEngine
        mock_ot.assert_called_once()
        assert engine.name.startswith("Provider")
