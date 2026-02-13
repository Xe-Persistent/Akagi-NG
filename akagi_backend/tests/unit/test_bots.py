import unittest
from unittest.mock import MagicMock, patch

import pytest

try:
    from akagi_ng.core.lib_loader import libriichi  # noqa: F401

    HAS_LIBRIICHI = True
except ImportError:
    HAS_LIBRIICHI = False

from akagi_ng.mjai_bot.mortal.bot import Mortal3pBot, MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext


class TestBots(unittest.TestCase):
    def setUp(self):
        # Mock engine loader
        self.loader_patcher = patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine")
        self.mock_loader = self.loader_patcher.start()

        # Mock Bot (libriichi.mjai.Bot-like object)
        self.mock_bot_instance = MagicMock()
        self.mock_bot_instance.react.return_value = {"type": "none", "meta": {"test": "ok"}}

        # Mock Engine
        self.mock_engine = MagicMock()
        self.mock_engine.engine_type = "mortal"
        self.mock_engine.last_inference_result = {}

        # load_model returns (Bot, Engine)
        self.mock_loader.return_value = (self.mock_bot_instance, self.mock_engine)
        self.status = BotStatusContext()

    def tearDown(self):
        self.loader_patcher.stop()

    @pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
    def test_mortal_bot_4p(self):
        print("\nTesting MortalBot (4P)...")
        bot = MortalBot(status=self.status)
        self.assertFalse(bot.is_3p)

        # Test Start Game
        event = {"type": "start_game", "id": 0, "is_3p": False}
        resp = bot.react(event)

        self.assertEqual(bot.player_id, 0)
        self.assertTrue(bot.model is not None)  # bot.model is the mock_bot_instance
        self.assertTrue(bot.engine is not None)

        print(f"Resp: {resp}")
        self.assertEqual(resp["type"], "none")
        # 游戏开始时应该有 game_start 标志
        self.assertTrue(resp.get("meta", {}).get("game_start", False))

    @pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
    def test_mortal_bot_3p(self):
        print("\nTesting Mortal3pBot (3P)...")
        bot = Mortal3pBot(status=self.status)
        self.assertTrue(bot.is_3p)

        # Mock react
        self.mock_bot_instance.react.return_value = {"type": "dahai", "pai": "1m", "meta": {"q_values": []}}

        event = {"type": "start_game", "id": 1}
        bot.react(event)

        self.assertEqual(bot.player_id, 1)


if __name__ == "__main__":
    unittest.main()
