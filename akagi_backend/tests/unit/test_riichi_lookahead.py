import json
import sys
import unittest
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.mortal.base import MortalBot


@pytest.fixture(autouse=True, scope="function")
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


class TestRiichiLookahead(unittest.TestCase):
    def setUp(self):
        self.logger = MagicMock()
        self.model_loader = MagicMock()
        self.bot = MortalBot(is_3p=False)
        self.bot.logger = self.logger
        self.bot.model_loader = self.model_loader
        self.bot.player_id = 0

    @patch("akagi_ng.mjai_bot.utils.meta_to_recommend")
    def test_handle_riichi_lookahead_trigger(self, mock_meta_to_recommend):
        # Case: Reach is in Top 3 -> Should run simulation
        mock_meta_to_recommend.return_value = [("reach", 0.8), ("discard", 0.15), ("chi", 0.05)]

        self.bot._run_riichi_lookahead = MagicMock(return_value={"simulated_q": [1.0, 2.0]})

        meta = {"q_values": [0.1], "mask_bits": 1}
        self.bot._handle_riichi_lookahead(meta)

        self.bot._run_riichi_lookahead.assert_called_once()
        self.assertEqual(meta["riichi_lookahead"], {"simulated_q": [1.0, 2.0]})
        self.logger.info.assert_any_call(
            "Riichi Lookahead: Reach is in Top 3 (['reach', 'discard', 'chi']). Starting simulation."
        )

    @patch("akagi_ng.mjai_bot.utils.meta_to_recommend")
    def test_handle_riichi_lookahead_no_trigger(self, mock_meta_to_recommend):
        # Case: Reach is NOT in Top 3 -> Should NOT run simulation
        mock_meta_to_recommend.return_value = [("discard", 0.8), ("chi", 0.15), ("pon", 0.05)]

        self.bot._run_riichi_lookahead = MagicMock()

        meta = {"q_values": [0.1], "mask_bits": 1}
        self.bot._handle_riichi_lookahead(meta)

        self.bot._run_riichi_lookahead.assert_not_called()
        self.assertNotIn("riichi_lookahead", meta)

    @patch("akagi_ng.mjai_bot.utils.meta_to_recommend")
    def test_handle_riichi_lookahead_error(self, mock_meta_to_recommend):
        # Case: Simulation returns error -> Should add to notification_flags
        mock_meta_to_recommend.return_value = [("reach", 0.9)]

        self.bot._run_riichi_lookahead = MagicMock(return_value={"error": True})

        meta = {"q_values": [0.1], "mask_bits": 1}
        self.bot._handle_riichi_lookahead(meta)

        self.assertEqual(self.bot.notification_flags["riichi_lookahead"], {"error": True})
        self.assertNotIn("riichi_lookahead", meta)

    def test_run_riichi_lookahead_simulation_success(self):
        """Test _run_riichi_lookahead executes full simulation flow successfully."""
        # 1. Setup Mock Bot and Engine returned by model_loader
        mock_sim_bot = MagicMock()
        mock_sim_engine = MagicMock()

        # Simulate simulation result
        expected_meta = {"q_values": [1.0], "mask_bits": 1}
        # sim_bot.react returns JSON string
        mock_sim_bot.react.side_effect = [
            None,  # React to game_start (is_3p=True)
            None,  # React to history event 1 (start_kyoku)
            None,  # React to history event 2 (discard)
            json.dumps({"meta": expected_meta}),  # React to REACH event
        ]

        self.bot.model_loader = MagicMock(return_value=(mock_sim_bot, mock_sim_engine))

        # Setup Bot state
        self.bot.player_id = 0
        self.bot.engine = MagicMock()  # Required for LookaheadBot instantiation
        self.bot.is_3p = True
        self.bot.game_start_event = {"type": "start_game"}
        self.bot.history_json = ['{"type": "start_kyoku"}', '{"type": "discard"}']

        # 2. Run with patched LookaheadBot
        with patch("akagi_ng.mjai_bot.mortal.base.LookaheadBot") as MockLookaheadBot:
            mock_lookahead_instance = MockLookaheadBot.return_value
            mock_lookahead_instance.simulate_reach.return_value = expected_meta

            result = self.bot._run_riichi_lookahead()

            # 3. Verify
            # Check LookaheadBot initialized with correct args
            MockLookaheadBot.assert_called_once_with(self.bot.engine, self.bot.player_id, is_3p=self.bot.is_3p)

            # Check simulate_reach called with correct args including game_start_event
            mock_lookahead_instance.simulate_reach.assert_called_once()
            args, kwargs = mock_lookahead_instance.simulate_reach.call_args
            self.assertEqual(args[0], self.bot.history)  # history_events
            self.assertEqual(args[1], {"type": "reach", "actor": self.bot.player_id})  # candidate_event
            self.assertEqual(kwargs.get("game_start_event"), self.bot.game_start_event)  # game_start_event

        # Verify result
        self.assertEqual(result, expected_meta)

    def test_run_riichi_lookahead_simulation_failure(self):
        """Test _run_riichi_lookahead handles simulation errors gracefully."""
        # Setup Mock that returns garbage JSON
        mock_sim_bot = MagicMock()
        mock_sim_engine = MagicMock()
        mock_sim_bot.react.return_value = "invalid json"

        self.bot.model_loader = MagicMock(return_value=(mock_sim_bot, mock_sim_engine))

        # Run
        result = self.bot._run_riichi_lookahead()

        # Verify error handling
        self.assertEqual(result, {"error": True})


if __name__ == "__main__":
    unittest.main()
