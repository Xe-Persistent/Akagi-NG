import json
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

# 检查 libriichi 是否可用
try:
    from akagi_ng.core.lib_loader import libriichi  # noqa: F401

    HAS_LIBRIICHI = True
except ImportError:
    HAS_LIBRIICHI = False

from akagi_ng.mjai_bot.mortal.bot import Mortal3pBot, MortalBot


class TestBots(unittest.TestCase):
    def setUp(self):
        # Mock engine loader
        self.loader_patcher = patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine")
        self.mock_loader = self.loader_patcher.start()

        # Mock Bot (libriichi.mjai.Bot-like object)
        self.mock_bot_instance = MagicMock()
        self.mock_bot_instance.react.return_value = json.dumps({"type": "none", "meta": {"test": "ok"}})

        # Mock Engine (不使用 spec 因为 get_additional_meta 等方法在子类中)
        self.mock_engine = MagicMock()
        self.mock_engine.get_additional_meta.return_value = {"engine_meta": 1}
        self.mock_engine.last_inference_result = {}

        # load_model returns (Bot, Engine)
        self.mock_loader.return_value = (self.mock_bot_instance, self.mock_engine)

    def tearDown(self):
        self.loader_patcher.stop()

    @pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
    def test_mortal_bot_4p(self):
        print("\nTesting MortalBot (4P)...")
        bot = MortalBot()
        self.assertFalse(bot.is_3p)

        # Test Start Game
        events = [{"type": "start_game", "id": 0}]
        resp = bot.react(json.dumps(events))

        self.assertEqual(bot.player_id, 0)
        self.assertTrue(bot.model is not None)  # bot.model is the mock_bot_instance
        self.assertTrue(bot.engine is not None)

        print(f"Resp: {resp}")
        resp_json = json.loads(resp)
        self.assertEqual(resp_json["type"], "none")
        # 游戏开始时应该有 game_start 标志
        self.assertTrue(resp_json.get("meta", {}).get("game_start", False))

    @pytest.mark.skipif(not HAS_LIBRIICHI, reason="libriichi not available in CI environment")
    def test_mortal_bot_3p(self):
        print("\nTesting Mortal3pBot (3P)...")
        bot = Mortal3pBot()
        self.assertTrue(bot.is_3p)

        # Mock react
        self.mock_bot_instance.react.return_value = json.dumps({"type": "dahai", "pai": "1m", "meta": {"q_values": []}})

        events = [{"type": "start_game", "id": 1}]
        bot.react(json.dumps(events))

        self.assertEqual(bot.player_id, 1)


if __name__ == "__main__":
    unittest.main()
