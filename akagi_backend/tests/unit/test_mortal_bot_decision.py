"""MortalBot 单元测试（合并自 test_mortal_bot_decision / test_bots / test_mortal_bot_edge_cases）"""

import json
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.bot import MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext

# 自动应用 mock_lib_loader_module fixture（定义在 unit/conftest.py 中）
pytestmark = pytest.mark.usefixtures("mock_lib_loader_module")


@pytest.fixture
def mock_engine_setup():
    """
    配置模型加载器的 Mock。
    """
    with patch("akagi_ng.mjai_bot.bot.load_bot_and_engine") as mock_loader:
        # 默认模拟一个打 1m 的响应
        mock_bot_instance = MagicMock()
        mock_bot_instance.react.return_value = json.dumps(
            {
                "type": "dahai",
                "pai": "1m",
                "meta": {
                    "q_values": [10.0] + [0.0] * 45,
                    "mask_bits": 1,
                },
            }
        )

        mock_engine = MagicMock()
        # 确保 Mock 拥有引擎协议要求的属性
        mock_engine.engine_type = "mortal"
        mock_engine.is_3p = False
        mock_engine.status = None  # 将由 bot 注入

        mock_loader.return_value = (mock_bot_instance, mock_engine)
        yield mock_loader, mock_bot_instance, mock_engine


# ===== 基本事件处理 =====


def test_event_processing_flow(mock_engine_setup) -> None:
    """验证基本的事件处理流程。"""
    _, mock_bot_instance, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)

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
    bot = MortalBot(status, is_3p=True)
    assert bot.is_3p is True

    # 模拟有多个合法动作的情况，确保 3p 不会抑制 meta
    mock_bot_instance.react.return_value = json.dumps(
        {
            "type": "dahai",
            "pai": "1m",
            "meta": {
                "q_values": [0.8, 0.7] + [0.0] * 44,
                "mask_bits": 3,
            },
        }
    )

    bot.react({"type": "start_game", "id": 1, "is_3p": True})
    # 手动设置 metadata 模拟 Provider 行为，因为单元测试直接测试 Bot
    status.set_metadata("engine_type", "mortal")
    resp = bot.react({"type": "tsumo", "actor": 1, "pai": "1m"})

    assert "meta" in resp
    # engine_type 应该通过 status.metadata 注入
    assert resp["meta"]["engine_type"] == "mortal"


def test_mortal3p_player_id(mock_engine_setup) -> None:
    """验证三麻 Bot 的 player_id 正确设置。（原 test_bots.py）"""
    _, mock_bot_instance, _ = mock_engine_setup
    mock_bot_instance.react.return_value = json.dumps({"type": "dahai", "pai": "1m", "meta": {"q_values": []}})

    status = BotStatusContext()
    bot = MortalBot(status, is_3p=True)
    assert bot.is_3p is True

    bot.react({"type": "start_game", "id": 1, "is_3p": True})
    assert bot.player_id == 1


# ===== 错误处理 & 边界情况 =====


def test_error_handling_malformed_json() -> None:
    """验证异常 JSON 输入时的错误响应。"""
    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)
    resp = bot.react("!!invalid!!")

    assert resp is None
    assert status.flags["bot_runtime_error"] is True


def test_mortal_bot_parse_error() -> None:
    """验证 invalid JSON 输入的处理。（原 test_mortal_bot_edge_cases.py）"""
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    res = bot.react("invalid json")
    assert res is None
    assert status.flags["bot_runtime_error"] is True


def test_mortal_bot_json_decode_error() -> None:
    """验证模型返回无效 JSON 时的处理。（原 test_mortal_bot_edge_cases.py）"""
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    bot.player_id = 0
    bot.model = MagicMock()
    bot.model.react.return_value = "corrupt { json"

    bot.engine = MagicMock()
    bot.engine.status = status

    res = bot.react(json.dumps([{"type": "dahai", "actor": 0, "tile": "1m"}]))
    assert res is None
    assert status.flags["bot_runtime_error"] is True


def test_mortal_bot_unknown_engine_notification() -> None:
    """验证 _handle_start_game 在未知引擎类型时不设置加载标志。（原 test_mortal_bot_edge_cases.py）"""
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    event = {"type": "start_game", "id": 0, "is_3p": False}
    mock_engine = MagicMock()
    status.set_metadata("engine_type", "alien_ai")

    with patch("akagi_ng.mjai_bot.bot.load_bot_and_engine") as mock_loader:
        mock_loader.return_value = (MagicMock(), mock_engine)
        bot._handle_start_game(event)

    assert "model_loaded_local" not in status.flags
    assert "model_loaded_online" not in status.flags


# ===== 通知标志 =====


def test_notification_flags_persistency(mock_engine_setup) -> None:
    """验证通知标志在对局中是持久的。"""
    _, _, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)
    bot.react({"type": "start_game", "id": 0, "is_3p": False})

    status.set_flag("game_connected", True)

    # 模拟下一轮推理
    bot.react({"type": "tsumo", "actor": 0, "pai": "2m"})

    # 验证标志依然存在
    assert status.flags["game_connected"] is True
