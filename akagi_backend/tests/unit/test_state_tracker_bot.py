import importlib
import json
import sys
from unittest.mock import MagicMock, patch

import pytest


# Mock mjai and its submodules before any imports
class MockBot:
    def __init__(self):
        self.self_riichi_accepted = False
        self.can_agari = False
        self.can_ankan = False
        self.can_discard = False
        self.tehai = []
        self.tehai_mjai = []
        self.last_kawa_tile = ""
        self.target_actor = 0
        self.last_self_tsumo = ""
        self.player_id = 0

    def action_discard(self, tile):
        return "{}"

    def action_nothing(self):
        return "{}"

    def brief_info(self):
        return "mock info"


mock_mjai = MagicMock()
mock_mjai.Bot = MockBot
mock_mjai_bot = MagicMock()
mock_mjai_bot_tools = MagicMock()
mock_mjai_mlibriichi = MagicMock()
mock_mjai_mlibriichi_state = MagicMock()
mock_mjai_mlibriichi_tools = MagicMock()
mock_numpy = MagicMock()

# Inject mocks into sys.modules
sys.modules["mjai"] = mock_mjai
sys.modules["mjai.bot"] = mock_mjai_bot
sys.modules["mjai.bot.tools"] = mock_mjai_bot_tools
sys.modules["mjai.mlibriichi"] = mock_mjai_mlibriichi
sys.modules["mjai.mlibriichi.state"] = mock_mjai_mlibriichi_state
sys.modules["mjai.mlibriichi.tools"] = mock_mjai_mlibriichi_tools
sys.modules["numpy"] = mock_numpy

import akagi_ng.mjai_bot.bot

importlib.reload(akagi_ng.mjai_bot.bot)
from akagi_ng.mjai_bot.bot import StateTrackerBot


@pytest.fixture
def bot():
    with (
        patch("akagi_ng.mjai_bot.bot.PlayerState") as MockPlayerState,
        patch("akagi_ng.mjai_bot.bot.calc_shanten") as MockShanten,
    ):
        MockShanten.return_value = 0
        bot = StateTrackerBot()
        bot.player_state = MockPlayerState.return_value
        return bot


def test_initialization(bot):
    assert bot.is_3p is False
    assert bot.meta == {}


def test_react_start_game(bot):
    event = {"type": "start_game", "id": 1}
    bot.react(event)
    assert bot.player_id == 1
    assert bot.is_3p is False


def test_react_start_kyoku(bot):
    event = {"type": "start_kyoku", "is_3p": True, "dora_marker": "1m"}
    bot.react(event)
    assert bot.is_3p is True


def test_find_daiminkan_candidates(bot):
    # 直接在实例上设置属性
    bot.tehai = MagicMock()
    bot.tehai_mjai = ["1m", "1m", "1m", "2m"]
    bot.last_kawa_tile = "1m"
    bot.target_actor = 1

    candidates = bot.find_daiminkan_candidates()
    assert len(candidates) == 1
    assert candidates[0]["consumed"] == ["1m", "1m", "1m"]
    assert candidates[0]["event"]["type"] == "daiminkan"


def test_find_ankan_candidates(bot):
    bot.tehai = MagicMock()
    bot.tehai_mjai = ["2m", "2m", "2m", "2m", "3m"]

    candidates = bot.find_ankan_candidates()
    assert len(candidates) == 1
    assert candidates[0]["consumed"] == ["2m", "2m", "2m", "2m"]
    assert candidates[0]["event"]["type"] == "ankan"


def test_find_kakan_candidates(bot):
    bot.tehai = MagicMock()
    bot.tehai_mjai = ["5m", "6m"]
    bot.player_id = 0
    # Mock 外部生成的内部私有变量
    bot._StateTrackerBot__call_events = [{"type": "pon", "actor": 0, "consumed": ["5m", "5m"]}]

    candidates = bot.find_kakan_candidates()
    assert len(candidates) == 1
    assert candidates[0]["consumed"] == ["5m"]
    assert candidates[0]["event"]["type"] == "kakan"


def test_nukidora_3p(bot):
    bot.player_id = 0
    bot.last_self_tsumo = "N"
    event = {"type": "nukidora", "actor": 0}
    bot.react(event)
    # 检查 discard_events 是否记录了替换后的事件
    assert any(e["type"] == "dahai" and e["pai"] == "N" for e in bot._StateTrackerBot__discard_events)


def test_error_handling(bot):
    # 模拟 BaseException
    with patch.object(bot, "think", side_effect=RuntimeError("test error")):
        res_str = bot.react({"type": "none"})
        res = json.loads(res_str)
        assert res["type"] == "none"
        assert "error" in res
