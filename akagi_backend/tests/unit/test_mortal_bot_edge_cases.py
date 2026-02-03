import json
from unittest.mock import MagicMock

import pytest

from akagi_ng.core import NotificationCode
from akagi_ng.mjai_bot.mortal.base import MortalBot


@pytest.fixture
def mortal_bot():
    return MortalBot(is_3p=False)


def test_mortal_bot_parse_error(mortal_bot):
    # Test invalid JSON input to react
    res_json = mortal_bot.react("invalid json")
    res = json.loads(res_json)
    assert res["error"] == NotificationCode.PARSE_ERROR


def test_mortal_bot_json_decode_error(mortal_bot):
    # Test invalid JSON from model
    mortal_bot.player_id = 0
    mortal_bot.model = MagicMock()
    mortal_bot.model.react.return_value = "corrupt { json"

    # We need a dummy engine to avoid crashes during meta collection
    mortal_bot.engine = MagicMock()
    mortal_bot.engine.get_notification_flags.return_value = {}

    res_json = mortal_bot.react(json.dumps([{"type": "dahai", "actor": 0, "tile": "1m"}]))
    res = json.loads(res_json)
    assert res["error"] == NotificationCode.JSON_DECODE_ERROR


def test_mortal_bot_unknown_engine_notification(mortal_bot):
    # Test _handle_start_game with unknown engine type
    event = {"type": "start_game", "id": 0}
    mock_engine = MagicMock()
    mock_engine.get_additional_meta.return_value = {"engine_type": "alien_ai"}

    mortal_bot.model_loader = lambda pid, is3p: (MagicMock(), mock_engine)

    mortal_bot._handle_start_game(event)
    # Check that pending notifications are empty or no specific "model_loaded_..." is set
    assert "model_loaded_local" not in mortal_bot._pending_notifications
    assert "model_loaded_online" not in mortal_bot._pending_notifications
