from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.core import NotificationCode
from akagi_ng.mjai_bot.controller import Controller


@pytest.fixture
def controller():
    return Controller()


def test_controller_nukidora_midgame_recovery(controller):
    # Setup bot to be mortal (4p)
    mock_mortal = MagicMock()
    controller.bot = mock_mortal

    # Receive nukidora
    event = {"type": "nukidora"}

    # Mock bot switch
    mock_mortal3p = MagicMock()
    mock_mortal3p.react.return_value = '{"type":"none"}'

    # Patch the creation of the bot inside _choose_bot_name
    # _choose_bot_name uses self.available_bots[index]()
    controller.available_bots = [lambda: mock_mortal, lambda: mock_mortal3p]
    controller.available_bots_names = ["mortal", "mortal3p"]

    res = controller.react(event)
    assert res == {"type": "none"}
    assert controller.bot == mock_mortal3p  # It should be the instance from our lambda


def test_controller_unmatched_event_sequence(controller):
    # Setup bot first
    controller.bot = MagicMock()
    controller.bot.react.return_value = '{"type":"none"}'

    # start_game followed by something NOT start_kyoku
    controller.react({"type": "start_game", "scores": [25000] * 4})
    res = controller.react({"type": "dahai", "actor": 0, "tile": "1m"})
    assert res == {"type": "none"}


def test_controller_json_decode_error(controller):
    controller.bot = MagicMock()
    controller.bot.react.return_value = "invalid json"
    res = controller.react({"type": "dahai", "actor": 0, "tile": "1m"})
    assert res["error"] == NotificationCode.JSON_DECODE_ERROR


def test_controller_bot_switch_failed(controller):
    # Simulate failed bot switch in _handle_start_kyoku_event
    with patch.object(controller, "_choose_bot_name", return_value=False):
        res = controller._handle_start_kyoku_event({"scores": [25000] * 4, "is_3p": False})
        assert res["error"] == NotificationCode.BOT_SWITCH_FAILED


def test_controller_runtime_error(controller):
    controller.bot = MagicMock()
    controller.bot.react.side_effect = Exception("Crash")
    res = controller.react({"type": "dahai", "actor": 0, "tile": "1m"})
    assert res["error"] == NotificationCode.BOT_RUNTIME_ERROR


def test_controller_no_bot_loaded(controller):
    # Reset controller to no bot
    controller.bot = None
    res = controller.react({"type": "dahai", "actor": 0, "tile": "1m"})
    assert res["error"] == NotificationCode.NO_BOT_LOADED
