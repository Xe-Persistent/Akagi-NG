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

    def test_run_riichi_lookahead_full_flow(self):
        # 1. Setup simulation mocks
        sim_bot = MagicMock()
        sim_engine = MagicMock()
        self.model_loader.return_value = (sim_bot, sim_engine)

        self.bot.history_json = ['{"type":"discard","tile":"1m"}']
        self.bot.game_start_event = {"type": "start_game", "id": 0}
        self.bot.is_3p = True

        # 2. Mock simulation response
        sim_meta = {"q_values": [1.0], "mask_bits": 1}
        sim_bot.react.return_value = json.dumps({"type": "none", "meta": sim_meta})

        # 3. Run
        result = self.bot._run_riichi_lookahead()

        # 4. Verify
        self.model_loader.assert_called_with(0, True)
        sim_engine.set_sync_mode.assert_any_call(True)
        sim_engine.set_sync_mode.assert_any_call(False)

        # Check that it replayed history
        sim_bot.react.assert_any_call('{"type":"start_game","id":0}')
        sim_bot.react.assert_any_call('{"type":"discard","tile":"1m"}')

        # Check that it ran reach simulation
        sim_bot.react.assert_any_call('{"type":"reach","actor":0}')

        self.assertEqual(result, sim_meta)


if __name__ == "__main__":
    unittest.main()
