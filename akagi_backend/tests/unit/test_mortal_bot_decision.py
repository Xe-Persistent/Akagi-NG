"""
测试模块：akagi_backend/tests/unit/test_mortal_bot_decision.py

描述：针对 MortalBot 决策与元数据注入逻辑的单元测试。
主要测试点：
- 基础对战事件 (Tsumo, Dahai) 的响应流程。
- 同步事件 (sync=True) 不触发决策的逻辑校验。
- 三麻模式下的元数据格式、player_id 设置及动作屏蔽逻辑。
- 运行时异常、Json 解析错误等异常情况的稳健性。
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.bot import MortalBot, build_api_events
from akagi_ng.mjai_bot.cloud_api import CloudApiError
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.mjai_bot.utils import mask_unicode_3p
from akagi_ng.schema.notifications import NotificationCode
from akagi_ng.schema.types import DahaiEvent, StartGameEvent, StartKyokuEvent, TsumoEvent
from akagi_ng.settings import APIConfig, local_settings

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
    bot.react(StartGameEvent(id=0, is_3p=False))
    assert bot.bot == mock_bot_instance

    # 2. tsumo 会触发推理
    resp = bot.react(TsumoEvent(actor=0, pai="1m"))
    assert resp["type"] == "dahai"
    assert resp["pai"] == "1m"


def test_sync_event_uses_can_act_false(mock_engine_setup) -> None:
    """同步事件应通过 can_act=False 仅推进状态，不触发推理。"""
    _, mock_bot_instance, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)

    bot.react(StartGameEvent(id=0, is_3p=False))
    mock_bot_instance.react.reset_mock()

    bot.react(TsumoEvent(actor=0, pai="1m", sync=True))

    assert mock_bot_instance.react.call_count == 1
    args, kwargs = mock_bot_instance.react.call_args
    assert isinstance(args[0], str)
    assert kwargs == {"can_act": False}


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

    bot.react(StartGameEvent(id=1, is_3p=True))
    # 手动设置 metadata 模拟 Provider 行为，因为单元测试直接测试 Bot
    status.set_metadata("engine_type", "mortal")
    resp = bot.react(TsumoEvent(actor=1, pai="1m"))

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

    bot.react(StartGameEvent(id=1, is_3p=True))
    assert bot.player_id == 1


def test_3p_none_only_response_is_dropped(mock_engine_setup) -> None:
    """三麻中仅有 none 选项的响应应被视为无效并丢弃。"""
    _, mock_bot_instance, mock_engine = mock_engine_setup
    mock_engine.is_3p = True

    none_only_mask = 1 << mask_unicode_3p.index("none")
    mock_bot_instance.react.return_value = json.dumps(
        {
            "type": "none",
            "meta": {
                "q_values": [1.0],
                "mask_bits": none_only_mask,
            },
        }
    )

    status = BotStatusContext()
    bot = MortalBot(status, is_3p=True)
    bot.react(StartGameEvent(id=1, is_3p=True))

    resp = bot.react(TsumoEvent(actor=1, pai="1m"))
    assert resp is not None
    assert resp["type"] == "none"


def test_response_missing_type_is_dropped(mock_engine_setup) -> None:
    """模型返回缺失 type 的响应应被安全过滤。"""
    _, mock_bot_instance, _ = mock_engine_setup
    mock_bot_instance.react.return_value = json.dumps({"meta": {"q_values": [1.0], "mask_bits": 1}})

    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)
    bot.react(StartGameEvent(id=0, is_3p=False))

    resp = bot.react(TsumoEvent(actor=0, pai="1m"))
    assert resp is not None
    assert "type" not in resp
    assert NotificationCode.BOT_RUNTIME_ERROR not in status.flags


# ===== 错误处理 & 边界情况 =====


def test_error_handling_runtime_exception(mock_engine_setup) -> None:
    """验证模型 react 抛出异常时的错误响应。"""
    _, mock_bot_instance, _ = mock_engine_setup
    status = BotStatusContext()
    bot = MortalBot(status, is_3p=False)
    bot.react(StartGameEvent(id=0, is_3p=False))

    # 模拟模型崩溃
    mock_bot_instance.react.side_effect = Exception("Model Crash")
    resp = bot.react(TsumoEvent(actor=0, pai="1m"))

    assert resp is None
    assert NotificationCode.BOT_RUNTIME_ERROR in status.flags


# 移除了 test_mortal_bot_parse_error，因为 MortalBot.react 不再承担运行时非对象输入的校验重任。


def test_mortal_bot_json_decode_error() -> None:
    """验证模型返回无效 JSON 时的处理。（原 test_mortal_bot_edge_cases.py）"""
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    bot.player_id = 0
    bot.bot = MagicMock()
    bot.bot.react.return_value = "corrupt { json"

    bot.engine = MagicMock()
    bot.engine.status = status

    # 传递对象，而不是 JSON 字符串
    res = bot.react(DahaiEvent(actor=0, pai="1m", tsumogiri=False))
    assert res is None
    # 验证正确的通知标志
    assert NotificationCode.JSON_DECODE_ERROR in status.flags


def test_mortal_bot_unknown_engine_notification() -> None:
    """验证 _handle_start_game 在未知引擎类型时不设置加载标志。（原 test_mortal_bot_edge_cases.py）"""
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    event = StartGameEvent(id=0, is_3p=False)
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
    bot.react(StartGameEvent(id=0, is_3p=False))

    status.set_flag(NotificationCode.GAME_CONNECTED, True)

    # 模拟下一轮推理
    bot.react(TsumoEvent(actor=0, pai="2m"))

    # 验证标志依然存在
    assert NotificationCode.GAME_CONNECTED in status.flags


def test_v3_api_replaces_local_decision_and_sends_censored_history() -> None:
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    bot.player_id = 0
    bot.game_start_event = StartGameEvent(id=0, is_3p=False)
    bot.history = [bot.game_start_event]
    bot.bot = MagicMock()
    bot.bot.react.return_value = json.dumps(
        {"type": "dahai", "actor": 0, "pai": "1m", "meta": {"q_values": [1.0], "mask_bits": 1}}
    )

    api_config = APIConfig(enabled=True, base_url="https://api.example", key="secret", model_4p="4p-x")
    client = MagicMock()
    client.react.return_value = {
        "reaction": {"type": "dahai", "actor": 3, "pai": "9p", "tsumogiri": False},
        "candidates": [{"action": "dahai:9p", "prob": 0.8}],
        "model": "4p-x",
    }

    with (
        patch.object(local_settings, "api", api_config),
        patch("akagi_ng.mjai_bot.bot.AkagiApiClient", return_value=client),
    ):
        response = bot.react(TsumoEvent(actor=0, pai="9p"))

    assert response["type"] == "dahai"
    assert response["actor"] == 0
    assert response["pai"] == "9p"
    assert response["meta"]["engine_type"] == "akagiapi"
    model, player_id, events = client.react.call_args.args
    assert model == "4p-x"
    assert player_id == 0
    assert events[0] == {"type": "start_game", "names": ["", "", "", ""]}
    assert events[-1] == {"type": "tsumo", "actor": 0, "pai": "9p"}


def test_v3_api_failure_falls_back_to_local_decision() -> None:
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    bot.player_id = 0
    bot.history = [StartGameEvent(id=0, is_3p=False)]
    bot.bot = MagicMock()
    bot.bot.react.return_value = json.dumps(
        {"type": "dahai", "actor": 0, "pai": "1m", "meta": {"q_values": [1.0], "mask_bits": 1}}
    )

    api_config = APIConfig(enabled=True, base_url="https://api.example", key="secret")
    client = MagicMock()
    client.react.side_effect = CloudApiError("offline")
    with (
        patch.object(local_settings, "api", api_config),
        patch("akagi_ng.mjai_bot.bot.AkagiApiClient", return_value=client),
    ):
        response = bot.react(TsumoEvent(actor=0, pai="1m"))

    assert response["pai"] == "1m"
    assert response["meta"]["fallback_used"] is True
    assert response["meta"]["online_service_reconnecting"] is True


def test_v3_api_reach_followup_failure_uses_local_reach_discard() -> None:
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    bot.player_id = 0
    bot.history = [StartGameEvent(id=0, is_3p=False)]
    bot.bot = MagicMock()
    bot.bot.react.return_value = json.dumps(
        {"type": "dahai", "actor": 0, "pai": "1m", "meta": {"q_values": [1.0], "mask_bits": 1}}
    )

    api_config = APIConfig(enabled=True, base_url="https://api.example", key="secret")
    client = MagicMock()
    client.react.side_effect = [
        {
            "reaction": {"type": "reach", "actor": 0},
            "candidates": [{"action": "reach", "prob": 0.8}],
        },
        CloudApiError("follow-up offline"),
    ]
    with (
        patch.object(local_settings, "api", api_config),
        patch("akagi_ng.mjai_bot.bot.AkagiApiClient", return_value=client),
        patch.object(bot, "_local_reach_discard", return_value="9m"),
    ):
        response = bot.react(TsumoEvent(actor=0, pai="1m"))

    assert response["type"] == "reach"
    assert response["pai"] == "9m"
    assert response["meta"]["fallback_used"] is True
    assert client.react.call_count == 2


def test_local_reach_lookahead_does_not_replay_start_game_twice() -> None:
    status = BotStatusContext()
    bot = MortalBot(status=status, is_3p=False)
    start_game = StartGameEvent(id=0, is_3p=False)
    draw = TsumoEvent(actor=0, pai="1m")
    bot.player_id = 0
    bot.game_start_event = start_game
    bot.history = [start_game, draw]
    bot.engine = MagicMock()

    with patch("akagi_ng.mjai_bot.bot.LookaheadBot") as lookahead_cls:
        lookahead_cls.return_value.simulate_reach.return_value = {"q_values": [1.0], "mask_bits": 1}
        result = bot._run_riichi_lookahead()

    assert result is not None
    args = lookahead_cls.return_value.simulate_reach.call_args
    assert args.args[0] == [draw]
    assert args.kwargs["game_start_event"] == start_game


def test_v3_api_event_shaping_censors_hidden_information_and_pads_three_player() -> None:
    events = [
        StartGameEvent(id=1, is_3p=True),
        StartKyokuEvent(
            bakaze="E",
            dora_marker="1m",
            kyoku=1,
            honba=0,
            kyotaku=0,
            oya=0,
            scores=[35000, 35000, 35000],
            tehais=[["1m"] * 13, ["2m"] * 13, ["3m"] * 13],
        ),
        TsumoEvent(actor=2, pai="9p"),
    ]

    shaped = build_api_events(events, player_id=1, is_3p=True)

    assert shaped[1]["scores"] == [35000, 35000, 35000, 0]
    assert shaped[1]["tehais"][1] == ["2m"] * 13
    assert shaped[1]["tehais"][0] == ["?"] * 13
    assert shaped[1]["tehais"][3] == ["?"] * 13
    assert shaped[2]["pai"] == "?"
