import json
from unittest.mock import MagicMock

import pytest

from akagi_ng.mjai_bot.mortal.base import MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode


@pytest.fixture
def mortal_bot():
    return MortalBot(status=BotStatusContext(), is_3p=False)


def test_mortal_bot_parse_error(mortal_bot):
    # Test invalid JSON input to react
    res = mortal_bot.react("invalid json")
    assert res["type"] == "none"
    assert mortal_bot.status.flags[NotificationCode.BOT_RUNTIME_ERROR] is True


def test_mortal_bot_json_decode_error(mortal_bot):
    # Test invalid JSON from model
    mortal_bot.player_id = 0
    mortal_bot.model = MagicMock()
    mortal_bot.model.react.return_value = "corrupt { json"

    # We need a dummy engine to avoid crashes during meta collection
    mortal_bot.engine = MagicMock()
    mortal_bot.engine.status = mortal_bot.status

    res = mortal_bot.react(json.dumps([{"type": "dahai", "actor": 0, "tile": "1m"}]))
    assert res["type"] == "none"
    # 现在模型如果抛出异常，底层会捕获并设置 BOT_RUNTIME_ERROR
    assert mortal_bot.status.flags[NotificationCode.BOT_RUNTIME_ERROR] is True


def test_mortal_bot_unknown_engine_notification(mortal_bot):
    # Test _handle_start_game with unknown engine type
    event = {"type": "start_game", "id": 0, "is_3p": False}
    mock_engine = MagicMock()
    # Note: _handle_start_game reads from status.metadata, not engine.engine_type
    # We simulate an unknown engine type in metadata
    mortal_bot.status.set_metadata(NotificationCode.ENGINE_TYPE, "alien_ai")

    from unittest.mock import patch

    # Correctly patch the function where it is used (inside _handle_start_game)
    with patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine") as mock_loader:
        mock_loader.return_value = (MagicMock(), mock_engine)
        mortal_bot._handle_start_game(event)

    # Check that flags are empty or no specific "model_loaded_..." is set
    assert NotificationCode.MODEL_LOADED_LOCAL not in mortal_bot.status.flags
    assert NotificationCode.MODEL_LOADED_ONLINE not in mortal_bot.status.flags
