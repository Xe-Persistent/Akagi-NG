import json
import sys
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.mortal.bot import Mortal3pBot, MortalBot


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
        # 索引 0 是 1m
        mock_bot_instance = MagicMock()
        mock_bot_instance.react.return_value = json.dumps(
            {
                "type": "dahai",
                "pai": "1m",
                "meta": {
                    "q_values": [10.0] + [0.0] * 45,  # 长度需匹配动作空间 (46)
                    "mask_bits": 1,  # 只有第 0 位 (1m) 为真
                },
            }
        )

        mock_engine = MagicMock()
        mock_engine.get_additional_meta.return_value = {"engine_type": "mortal"}
        mock_engine.get_notification_flags.return_value = {}

        mock_loader.return_value = (mock_bot_instance, mock_engine)
        yield mock_loader, mock_bot_instance, mock_engine


def test_event_processing_flow(mock_engine_setup) -> None:
    """验证基本的事件处理流程。"""
    bot = MortalBot()

    # 单个 start_game 不会触发推理，返回 type: none
    resp = bot.react(json.dumps([{"type": "start_game", "id": 0}]))
    data = json.loads(resp)
    assert data["type"] == "none"
    assert data["meta"]["game_start"] is True

    # 包含第二个事件会触发推理
    _, _, _ = mock_engine_setup
    resp = bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "1m"}]))
    data = json.loads(resp)
    assert data["type"] == "dahai"


def test_meta_data_format_3p(mock_engine_setup) -> None:
    """验证三麻模式下的数据格式。"""
    bot = Mortal3pBot()
    assert bot.is_3p is True

    # 模拟有多个合法动作的情况，确保 3p 不会抑制 meta
    _, mock_bot_instance, _ = mock_engine_setup
    mock_bot_instance.react.return_value = json.dumps(
        {
            "type": "dahai",
            "pai": "1m",
            "meta": {
                "q_values": [0.8, 0.7] + [0.0] * 44,
                "mask_bits": 3,  # 1m 和 2m 都合法
            },
        }
    )

    bot.react(json.dumps([{"type": "start_game", "id": 1}]))
    resp = bot.react(json.dumps([{"type": "tsumo", "actor": 1, "pai": "1m"}]))
    data = json.loads(resp)

    assert "meta" in data
    assert data["meta"]["engine_type"] == "mortal"


def test_riichi_lookahead_logic_trigger(mock_engine_setup) -> None:
    """验证立直前瞻逻辑的自动触发。"""
    _, mock_bot_instance, _ = mock_engine_setup
    bot = MortalBot()

    # 构造立直作为 Top 1 推荐的数据
    # index 37 是 reach
    q_values = [0.0] * 46
    q_values[37] = 20.0  # 极高 Q 值确保是 Top 1
    mask_bits = 1 << 37

    mock_bot_instance.react.return_value = json.dumps(
        {"type": "none", "meta": {"q_values": q_values, "mask_bits": mask_bits}}
    )

    # 初始化后发送一个会触发推理的事件
    bot.react(json.dumps([{"type": "start_game", "id": 0}]))

    with patch.object(bot, "_run_riichi_lookahead", return_value={"sim_q": 1.0}) as mock_run:
        bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "1m"}]))
        # 验证因为立直在推荐名单中，所以触发了前瞻模拟
        mock_run.assert_called_once()


def test_error_handling_malformed_json() -> None:
    """验证异常 JSON 输入时的错误响应。"""
    bot = MortalBot()
    resp = bot.react("!!invalid!!")
    data = json.loads(resp)

    assert data["type"] == "none"
    assert "error" in data
    # 根据 NotificationCode.PARSE_ERROR 的定义，这里应该是字符串
    assert isinstance(data["error"], str)


def test_notification_flags_clearing(mock_engine_setup, initialized_bot) -> None:
    """验证通知标志在每轮决策前会被清理。"""
    bot = initialized_bot
    bot.notification_flags = {"stale_flag": "should_be_removed"}

    # 模拟下一轮推理
    bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "2m"}]))

    # 验证旧标志已清理
    assert "stale_flag" not in bot.notification_flags


@pytest.fixture
def initialized_bot(mock_engine_setup):
    bot = MortalBot()
    bot.react(json.dumps([{"type": "start_game", "id": 0}]))
    return bot
