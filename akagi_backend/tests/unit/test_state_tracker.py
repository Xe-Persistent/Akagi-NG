"""StateTracker 单元测试"""

from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.mjai_bot.tracker import StateTracker


@pytest.fixture
def status_ctx():
    return BotStatusContext()


@pytest.fixture
def bot(status_ctx):
    return StateTracker(status=status_ctx)


def test_initialization(bot):
    assert bot.is_3p is False
    assert bot.meta == {}
    assert bot.player_id == 0
    assert bot.player_state is None
    assert bot.last_self_tsumo is None
    assert bot.tehai_mjai_with_aka == []


def test_react_start_game(bot):
    with patch("akagi_ng.core.lib_loader.libriichi.state.PlayerState") as MockPlayerState:
        event = {"type": "start_game", "id": 1, "is_3p": False}
        bot.react(event)

        assert bot.player_id == 1
        assert bot.is_3p is False
        assert bot.player_state is not None
        MockPlayerState.assert_called_with(1)
        # 验证 update 也被调用
        MockPlayerState.return_value.update.assert_called_once()


def test_react_nukidora_conversion(bot):
    bot.player_id = 0
    bot.player_state = MagicMock()
    bot.player_state.last_self_tsumo.return_value = "N"

    event = {"type": "nukidora", "actor": 0}
    # nukidora 内部会判断 == "N"
    bot.react(event)

    # 验证转换为了 dahai 调用 update
    called_args = bot.player_state.update.call_args[0][0]
    assert "dahai" in called_args
    assert '"pai": "N"' in called_args


def test_error_handling(bot):
    bot.player_state = MagicMock()
    bot.player_state.update.side_effect = RuntimeError("test error")

    res = bot.react({"type": "dahai", "actor": 1, "pai": "1m", "tsumogiri": False})
    assert res is None
    assert bot.status.flags.get("state_tracker_error") is True


def test_properties_pass_through(bot):
    bot.player_state = MagicMock()
    bot.player_state.last_self_tsumo.return_value = "1m"
    bot.player_state.last_kawa_tile.return_value = "2m"
    bot.player_state.self_riichi_accepted = True
    bot.player_state.last_cans.can_tsumo_agari = True

    assert bot.last_self_tsumo == "1m"
    assert bot.last_kawa_tile == "2m"
    assert bot.self_riichi_accepted is True
    assert bot.can_tsumo_agari is True


def test_tehai_mjai_with_aka(bot):
    bot.player_state = MagicMock()

    # 模拟手牌 (1m x1, 5m x2, 5p x1, 中 x1)
    # index: 1m=0, 5m=4, 5p=13, 中(C)=33
    tehai = [0] * 34
    tehai[0] = 1
    tehai[4] = 2
    tehai[13] = 1
    tehai[33] = 1

    bot.player_state.tehai = tehai

    # 持有 5mr, 不持有 5pr
    bot.player_state.akas_in_hand = [True, False, False]

    result = bot.tehai_mjai_with_aka

    assert len(result) == 5
    assert "1m" in result
    assert "5mr" in result
    assert "5m" in result
    assert "5p" in result
    assert "C" in result

    # 确保排序正确（依照字面量先后顺序）
    assert result == ["1m", "5mr", "5m", "5p", "C"]
