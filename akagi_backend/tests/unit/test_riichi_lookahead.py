import json
import sys
import unittest
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.lookahead import LookaheadBot
from akagi_ng.mjai_bot.mortal.base import MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode


@pytest.fixture(autouse=True, scope="function")
def mock_lib_loader_module():
    """只有在找不到真实二进制库时才进行彻底 Mock"""
    try:
        from akagi_ng.core import lib_loader  # noqa: F401

        # 如果能导入，说明环境中有真实库，不进行 patch
        yield None
    except ImportError:
        mock_module = MagicMock()
        mock_module.libriichi = MagicMock()
        mock_module.libriichi.mjai.Bot = MagicMock

        mock_module.libriichi3p = MagicMock()
        mock_module.libriichi3p.mjai.Bot = MagicMock

        with patch.dict(sys.modules, {"akagi_ng.core.lib_loader": mock_module}):
            yield mock_module


class TestRiichiLookahead(unittest.TestCase):
    def setUp(self):
        self.logger = MagicMock()
        self.model_loader = MagicMock()
        self.status = BotStatusContext()
        self.bot = MortalBot(status=self.status, is_3p=False)
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

        self.bot._run_riichi_lookahead = MagicMock(return_value=None)

        meta = {"q_values": [0.1], "mask_bits": 1}
        self.bot._handle_riichi_lookahead(meta)

        self.assertTrue(self.bot.status.flags.get(NotificationCode.RIICHI_SIM_FAILED))
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
        mock_engine = MagicMock()
        mock_engine.status = BotStatusContext()
        self.bot.engine = mock_engine  # Required for LookaheadBot instantiation
        self.bot.is_3p = True
        self.bot.game_start_event = {"type": "start_game", "id": 0, "is_3p": True}
        unknown_tehai = ["?"] * 13
        self.bot.history_json = [
            json.dumps(
                {
                    "type": "start_kyoku",
                    "bakaze": "E",
                    "kyoku": 1,
                    "honba": 0,
                    "kyotaku": 0,
                    "oya": 0,
                    "scores": [25000] * 4,
                    "dora_marker": "1p",
                    "tehais": [["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "E", "E", "S"]]
                    + [unknown_tehai] * 3,
                    "is_3p": True,
                }
            ),
            json.dumps({"type": "tsumo", "actor": 0, "pai": "S"}),
        ]

        # 2. Run with patched LookaheadBot
        with patch("akagi_ng.mjai_bot.mortal.base.LookaheadBot") as MockLookaheadBot:
            mock_lookahead_instance = MockLookaheadBot.return_value
            mock_lookahead_instance.simulate_reach.return_value = expected_meta

            result = self.bot._run_riichi_lookahead()

            # Check LookaheadBot initialized with correct args
            # Note: Now uses sim_engine = self.engine.fork(status=sim_status)
            MockLookaheadBot.assert_called_once()
            args, kwargs = MockLookaheadBot.call_args
            self.assertEqual(args[1], self.bot.player_id)
            self.assertEqual(kwargs.get("is_3p"), self.bot.is_3p)

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
        self.assertIsNone(result)

    def test_lookahead_with_replay_engine(self):
        """测试使用 ReplayEngine 进行 Lookahead 模拟"""
        mock_loader = sys.modules["akagi_ng.core.lib_loader"]
        mock_loader.libriichi.mjai.Bot = MagicMock(return_value=MagicMock())

        # 创建 mock engine
        mock_engine = MagicMock()
        mock_engine.status = BotStatusContext()
        mock_engine.last_inference_result = {
            "actions": [5],
            "q_out": [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
            "masks": [[True, False, True, True, False, True]],
            "is_greedy": [True],
        }

        # 创建 LookaheadBot
        lookahead_bot = LookaheadBot(mock_engine, player_id=0, is_3p=False)

        # Mock ReplayEngine (由于它在方法内部导入，我们需要 patch 它)
        with patch("akagi_ng.mjai_bot.engine.replay.ReplayEngine") as MockReplayEngine:
            # 配置 Mock ReplayEngine 实例
            mock_replay_instance = MockReplayEngine.return_value

            # 配置 sim_bot (libs.mjai.Bot) 的行为
            # 注意：LookaheadBot 现在会创建一个新的 sim_bot
            mock_sim_bot = mock_loader.libriichi.mjai.Bot.return_value
            mock_sim_bot.react.side_effect = [
                None,  # game_start
                None,  # history
                json.dumps({"type": "dahai", "meta": {"q_values": [0.1], "mask_bits": 45}}),  # reach event
            ]

            # 执行模拟
            result = lookahead_bot.simulate_reach(
                history_events=[
                    {
                        "type": "start_kyoku",
                        "bakaze": "E",
                        "kyoku": 1,
                        "honba": 0,
                        "kyotaku": 0,
                        "oya": 0,
                        "scores": [25000] * 4,
                        "dora_marker": "1p",
                        "tehais": [["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "E", "E", "S"]]
                        + [["?"] * 13] * 3,
                        "is_3p": False,
                    }
                ],
                candidate_event={"type": "reach", "actor": 0},
                game_start_event={"type": "start_game", "id": 0, "is_3p": False},
            )

            # 验证 ReplayEngine 被正确初始化
            MockReplayEngine.assert_called_once_with(mock_engine.status, mock_engine)

            # 验证 stop_replaying 被调用
            mock_replay_instance.stop_replaying.assert_called_once()

            # 验证结果
            self.assertIsNotNone(result)
            self.assertEqual(result["mask_bits"], 45)


if __name__ == "__main__":
    unittest.main()
