import sys
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.mortal.bot import Mortal3pBot, MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode


@pytest.fixture(autouse=True)
def mock_lib_loader_module():
    """彻底 Mock 掉 lib_loader 模块，防止加载真实二进制库"""
    mock_module = MagicMock()
    mock_module.libriichi = MagicMock()
    # Mock Bot class
    mock_module.libriichi.mjai.Bot = MagicMock

    mock_module.libriichi3p = MagicMock()
    mock_module.libriichi3p.mjai.Bot = MagicMock

    with patch.dict(sys.modules, {"akagi_ng.core.lib_loader": mock_module}):
        yield mock_module


@pytest.fixture
def mock_engine_setup():
    """
    配置模型加载器的 Mock。
    """
    with patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine") as mock_loader:
        # 默认模拟一个打 1m 的响应
        mock_bot_instance = MagicMock()
        mock_bot_instance.react.return_value = {
            "type": "dahai",
            "pai": "1m",
            "meta": {
                "q_values": [10.0] + [0.0] * 45,
                "mask_bits": 1,
            },
        }

        mock_engine = MagicMock()
        # 确保 Mock 拥有引擎协议要求的属性
        mock_engine.engine_type = "mortal"
        mock_engine.is_3p = False
        mock_engine.status = None  # 将由 bot 注入

        mock_loader.return_value = (mock_bot_instance, mock_engine)
        yield mock_loader, mock_bot_instance, mock_engine


def test_event_processing_flow(mock_engine_setup) -> None:
    """验证基本的事件处理流程。"""
    _, mock_bot_instance, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status)

    # 1. start_game 初始化
    bot.react({"type": "start_game", "id": 0, "is_3p": False})
    assert bot.model == mock_bot_instance

    # 2. tsumo 会触发推理
    resp = bot.react({"type": "tsumo", "actor": 0, "pai": "1m"})
    assert resp["type"] == "dahai"
    assert resp["pai"] == "1m"


def test_meta_data_format_3p(mock_engine_setup) -> None:
    """验证三麻模式下的数据格式。"""
    _, mock_bot_instance, mock_engine = mock_engine_setup
    mock_engine.is_3p = True

    status = BotStatusContext()
    bot = Mortal3pBot(status)
    assert bot.is_3p is True

    # 模拟有多个合法动作的情况，确保 3p 不会抑制 meta
    mock_bot_instance.react.return_value = {
        "type": "dahai",
        "pai": "1m",
        "meta": {
            "q_values": [0.8, 0.7] + [0.0] * 44,
            "mask_bits": 3,
        },
    }

    bot.react({"type": "start_game", "id": 1, "is_3p": True})
    # 手动设置 metadata 模拟 Provider 行为，因为单元测试直接测试 Bot
    status.set_metadata(NotificationCode.ENGINE_TYPE, "mortal")
    resp = bot.react({"type": "tsumo", "actor": 1, "pai": "1m"})

    assert "meta" in resp
    # engine_type 应该通过 status.metadata 注入
    assert resp["meta"]["engine_type"] == "mortal"


def test_error_handling_malformed_json() -> None:
    """验证异常 JSON 输入时的错误响应。"""
    status = BotStatusContext()
    bot = MortalBot(status)
    resp = bot.react("!!invalid!!")

    assert resp["type"] == "none"
    # 验证错误标志已设置
    assert status.flags[NotificationCode.BOT_RUNTIME_ERROR] is True


def test_notification_flags_persistency(mock_engine_setup) -> None:
    """验证通知标志在对局中是持久的。"""
    _, _, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status)
    bot.react({"type": "start_game", "id": 0, "is_3p": False})

    status.set_flag(NotificationCode.GAME_CONNECTED, True)

    # 模拟下一轮推理
    bot.react({"type": "tsumo", "actor": 0, "pai": "2m"})

    # 验证标志依然存在
    assert status.flags[NotificationCode.GAME_CONNECTED] is True
