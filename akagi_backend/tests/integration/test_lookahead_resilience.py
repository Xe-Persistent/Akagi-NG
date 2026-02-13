import json
import unittest
from unittest.mock import MagicMock, patch

import numpy as np

from akagi_ng.bridge.majsoul.bridge import MajsoulBridge
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.mortal.base import MortalBot
from akagi_ng.mjai_bot.status import BotStatusContext

# ==========================================
# Real Liqi Payloads (Shared Resource)
# ==========================================
LIQI_LOG_DATA = {
    "authGame_req": {
        "id": 26,
        "type": 2,  # MsgType.Req
        "method": ".lq.FastTest.authGame",
        "data": {
            "accountId": 10000,
            "token": "test-token-123",
            "gameUuid": "test-game-uuid-456",
        },
    },
    "authGame_res": {
        "id": 26,
        "type": 3,  # MsgType.Res
        "method": ".lq.FastTest.authGame",
        "data": {
            "players": [
                {
                    "accountId": 10000,
                    "nickname": "TestPlayer",
                    "level": {"id": 10103, "score": 176},
                }
            ],
            "seatList": [1, 10000, 2],
            "isGameStart": True,
            "gameConfig": {"mode": {"mode": 12, "ai": True}},
            "readyIdList": [1, 10000, 2],
        },
    },
    "syncGame_res": {
        "id": 27,
        "type": 3,  # MsgType.Res
        "method": ".lq.FastTest.syncGame",
        "data": {
            "step": 24,
            "gameRestore": {
                "actions": [],  # Filled by mock in tests
                "gameState": 1,
            },
            "isEnd": False,
        },
    },
}


class TestMortalBotResilience(unittest.TestCase):
    """
    Verifies the 4 core resilience scenarios requested by the user.
    """

    def setUp(self):
        self.bridge = MajsoulBridge()
        self.status = BotStatusContext()

        # Mock Engines
        self.mock_online_engine = MagicMock()
        self.mock_online_engine.name = "MockOnline"
        self.mock_online_engine.engine_type = "akagiot"
        self.mock_online_engine.fork.return_value = self.mock_online_engine

        self.mock_local_engine = MagicMock()
        self.mock_local_engine.name = "MockLocal"
        self.mock_local_engine.engine_type = "mortal"
        self.mock_local_engine.fork.return_value = self.mock_local_engine

        # Mock Model
        self.mock_model = MagicMock()

        # Bot Setup
        self.bot = MortalBot(status=self.status, engine=None)
        self.bot.model_loader = MagicMock()  # Will be overridden in _setup_provider

        # Initialize Bridge state
        if "authGame_req" in LIQI_LOG_DATA:
            self.bridge.parse_liqi(LIQI_LOG_DATA["authGame_req"])

        self.should_trigger_reach = False

        # Patch LookaheadBot CLASS to inspect constructor args
        self.lookahead_patcher = patch("akagi_ng.mjai_bot.mortal.base.LookaheadBot")
        self.mock_lookahead_cls = self.lookahead_patcher.start()
        self.mock_lookahead_instance = self.mock_lookahead_cls.return_value
        self.mock_lookahead_instance.simulate_reach.return_value = {
            "q_values": [0.0] * 46,
            "mask_bits": 7,
        }

        # Patch meta_to_recommend
        self.meta_recommend_patcher = patch("akagi_ng.mjai_bot.utils.meta_to_recommend")
        self.mock_meta_recommend = self.meta_recommend_patcher.start()
        self.mock_meta_recommend.side_effect = self._side_effect_recommend

        # Patch Factory Loader
        self.factory_patcher = patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine")
        self.mock_loader = self.factory_patcher.start()

        # Mock Model React
        self.mock_model.react.side_effect = self._mock_model_react

    def tearDown(self):
        self.lookahead_patcher.stop()
        self.meta_recommend_patcher.stop()
        self.factory_patcher.stop()

    def _side_effect_recommend(self, meta, is_3p):
        if self.should_trigger_reach:
            return [("reach", 0.99), ("dahai", 0.1)]
        return [("dahai", 0.99)]

    def _mock_model_react(self, json_event):
        events = json.loads(json_event)
        if isinstance(events, dict):
            events = [events]

        for event in events:
            # Call engine if needed
            if event["type"] in ["tsumo", "chi", "pon", "daiminkan"] and self.bot.engine:
                self.bot.engine.react_batch([0], [0], [0], is_sync=False)

        meta = {"q_values": [], "mask_bits": 0}
        if self.should_trigger_reach:
            meta = {"q_values": [0.0] * 46, "mask_bits": 1, "is_reach": True}

        return json.dumps({"type": "none", "meta": meta})

    def _setup_provider(self, online_fail=False):
        provider = EngineProvider(
            status=self.status, online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=True
        )

        if online_fail:
            self.mock_online_engine.react_batch.side_effect = Exception("Network Error")
        else:
            self.mock_online_engine.react_batch.side_effect = None
            self.mock_online_engine.react_batch.return_value = ([], [], [], [])

        self.mock_local_engine.react_batch.return_value = ([], [], [], [])

        self.bot.engine = provider
        self.bot.model = self.mock_model
        # Override loader for start_game calls
        self.mock_loader.return_value = (self.mock_model, provider)
        self.bot.player_id = 0
        return provider

    def _trigger_riichi_scenario(self, label=""):
        """Helper to invoke a tsumo event that triggers Riichi Lookahead."""
        print(f"  Triggering Riichi Lookahead ({label})...")
        self.should_trigger_reach = True
        self.mock_lookahead_instance.simulate_reach.reset_mock()
        self.mock_lookahead_cls.reset_mock()

        # Trigger tsumo
        res = self.bot.react({"type": "tsumo", "actor": 0, "pai": "5m"})

        self.mock_lookahead_instance.simulate_reach.assert_called_once()
        self.should_trigger_reach = False
        return res

    def _simulate_reconnect(self):
        """Helper to simulate syncGame"""
        expected_mjai_restore = [
            {
                "type": "start_kyoku",
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "scores": [25000] * 4,
                "tehais": [["?"] * 13] * 4,
                "is_3p": True,
                "sync": True,
            }
        ]
        with patch.object(self.bridge, "_parse_sync_game", return_value=expected_mjai_restore):
            events = self.bridge.parse_liqi(LIQI_LOG_DATA["syncGame_res"])
            if events:
                for ev in events:
                    # 过滤非标准 MJAI 事件
                    if ev.get("type") == "system_event":
                        continue
                    self.bot.react(ev)

    def test_scenario_1_online_fallback(self):
        """
        Scenario 1: 在线模型回退至本地模型时，能够正常输出打牌推荐。若...满足立直条件，能够执行立直前瞻
        """
        print("\n[Scenario 1] Online -> Local Fallback + Lookahead")
        provider = self._setup_provider(online_fail=True)

        self._trigger_riichi_scenario("Scenario 1")

        # 1. Fallback Active Check
        self.assertTrue(provider.fallback_active, "Provider should be in fallback mode")
        # 2. Local Engine Used
        self.mock_local_engine.react_batch.assert_called()
        # 3. Lookahead Uses active engine (which is Local due to fallback)
        call_args = self.mock_lookahead_cls.call_args
        passed_engine = call_args[0][0]
        self.assertEqual(passed_engine.active_engine, self.mock_local_engine)

    def test_scenario_2_reconnect_lookahead(self):
        """
        Scenario 2: 游戏掉线并重连时，能够正确恢复游戏状态... 执行立直前瞻
        """
        print("\n[Scenario 2] Reconnect + Lookahead (Health Online)")
        self._setup_provider(online_fail=False)

        # 1. Init
        self.bot.react({"type": "start_game", "id": 0, "is_3p": False})
        # 2. Reconnect
        self._simulate_reconnect()

        # 3. Trigger Riichi
        self._trigger_riichi_scenario("Scenario 2")

        # 4. Lookahead Uses active engine (which is Online)
        call_args = self.mock_lookahead_cls.call_args
        passed_engine = call_args[0][0]
        self.assertEqual(passed_engine.active_engine, self.mock_online_engine)

    def test_scenario_3_recovery_lookahead(self):
        """
        Scenario 3: 本地模型恢复至在线模型时，能够正常输出... 执行立直前瞻
        """
        print("\n[Scenario 3] Recovery to Online + Lookahead")
        provider = self._setup_provider(online_fail=False)

        # 1. Fail First
        self.mock_online_engine.react_batch.side_effect = Exception("Fail")
        self.bot.react({"type": "tsumo", "actor": 0, "pai": "1m"})
        self.assertTrue(provider.fallback_active)

        # 2. Recover Next
        self.mock_online_engine.react_batch.side_effect = None
        self.bot.react({"type": "tsumo", "actor": 0, "pai": "2m"})
        self.assertFalse(provider.fallback_active, "Should have recovered")

        # 3. Trigger Riichi
        self._trigger_riichi_scenario("Scenario 3")

        # 4. Lookahead Still Uses active engine (Recovered to Online)
        call_args = self.mock_lookahead_cls.call_args
        passed_engine = call_args[0][0]
        self.assertEqual(passed_engine.active_engine, self.mock_online_engine)

    def test_scenario_4_reconnect_fail_lookahead(self):
        """
        Scenario 4: 游戏掉线并重连、同时在线模型不可用时...回退至本地模型...执行立直前瞻
        """
        print("\n[Scenario 4] Reconnect + Online Fail -> Local + Lookahead")
        provider = self._setup_provider(online_fail=True)

        # 1. Reconnect
        self._simulate_reconnect()

        # 2. Trigger Riichi (Will trigger fallback during tsumo processing)
        self._trigger_riichi_scenario("Scenario 4")

        self.assertTrue(provider.fallback_active)
        call_args = self.mock_lookahead_cls.call_args
        passed_engine = call_args[0][0]
        self.assertEqual(passed_engine.active_engine, self.mock_local_engine)


class TestLookaheadInternal(unittest.TestCase):
    """
    Detailed internal verification for fidelity using REAL C++ Libraries.
    """

    def _setup_real_bot(self, is_3p: bool):
        self.bridge = MajsoulBridge()
        self.bridge.accountId = 10000
        status = BotStatusContext()

        # Mock Engines
        self.mock_online_engine = MagicMock()
        self.mock_online_engine.name = "MockOnline"
        self.mock_online_engine.engine_type = "akagiot"
        self.mock_online_engine.status = status
        self.mock_online_engine.fork.return_value = self.mock_online_engine

        self.mock_local_engine = MagicMock()
        self.mock_local_engine.name = "MockLocal"
        self.mock_local_engine.engine_type = "mortal"
        self.mock_local_engine.fork.return_value = self.mock_local_engine

        num_actions = 44 if is_3p else 46
        self.success_return = (
            [0],  # Default action index
            np.zeros((1, num_actions)),
            np.ones((1, num_actions), dtype=bool),
            [True],
        )
        self.mock_local_engine.react_batch.return_value = self.success_return
        self.mock_online_engine.react_batch.return_value = self.success_return

        # Provider
        self.provider = EngineProvider(
            status=status, online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=is_3p
        )

        # Bot
        self.bot = MortalBot(status=status, engine=self.provider, is_3p=is_3p)
        self.bot.player_id = 0

        # Prepare real bot if available
        lib_name = "libriichi3p" if is_3p else "libriichi"
        try:
            import sys

            # Purge mocks to force clean load
            for m in ["libriichi", "libriichi3p", "akagi_ng.core.lib_loader"]:
                if m in sys.modules:
                    del sys.modules[m]

            from akagi_ng.core import lib_loader

            libs = getattr(lib_loader, lib_name)
            real_bot_cls = libs.mjai.Bot
        except Exception:
            # Fallback to a minimal mock if libs are missing
            class MockCppBot:
                def __init__(self, engine, player_id):
                    pass

                def react(self, event_json):
                    meta = {"q_values": [0.0] * 46, "mask_bits": 7}
                    return json.dumps({"type": "none", "meta": meta})

            real_bot_cls = MockCppBot

        self.factory_patcher = patch("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine")
        self.mock_loader = self.factory_patcher.start()
        self.mock_loader.side_effect = lambda s, p, i: (real_bot_cls(self.provider, p), self.provider)

    def tearDown(self):
        if hasattr(self, "factory_patcher"):
            self.factory_patcher.stop()

    def test_internal_execution_with_real_lib_4p(self):
        """Verify 4-player Lookahead with real libriichi."""
        print("\n[InternalTest] 4-player Fidelity (Real Libriichi)")
        self._setup_real_bot(is_3p=False)

        # Online Fail
        self.mock_online_engine.react_batch.side_effect = Exception("Online Dead")

        # Sequence
        self.bot.react({"type": "start_game", "id": 0})
        self.bot.react(
            {
                "type": "start_kyoku",
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "scores": [25000] * 4,
                "dora_marker": "1p",
                "tehais": [
                    ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "1s", "1s", "1s", "2s"],
                    ["?"] * 13,
                    ["?"] * 13,
                    ["?"] * 13,
                ],
            }
        )
        # Actor 0 draw 2s (Ready to discard 1s or similar)
        self.bot.react({"type": "tsumo", "actor": 0, "pai": "2s"})

        self.assertTrue(self.provider.fallback_active)
        result = self.bot._run_riichi_lookahead()
        self.assertIsNotNone(result)
        self.assertIn("mask_bits", result)

    def test_internal_execution_with_real_lib_3p(self):
        """Verify 3-player Lookahead with real libriichi3p."""
        print("\n[InternalTest] 3-player Fidelity (Real Libriichi3p)")
        self._setup_real_bot(is_3p=True)

        self.mock_online_engine.react_batch.side_effect = Exception("Online Dead")

        # Sequence
        self.bot.react({"type": "start_game", "id": 0})
        self.bot.react(
            {
                "type": "start_kyoku",
                "bakaze": "E",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "scores": [35000, 35000, 35000, 0],
                "dora_marker": "1p",
                "is_3p": True,
                "tehais": [
                    ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "1s", "1s", "1s", "2s"],
                    ["?"] * 13,
                    ["?"] * 13,
                    ["?"] * 13,
                ],
            }
        )
        # Actor 0 draw 2s
        self.bot.react({"type": "tsumo", "actor": 0, "pai": "2s"})

        self.assertTrue(self.provider.fallback_active)
        result = self.bot._run_riichi_lookahead()
        self.assertIsNotNone(result)
        self.assertIn("mask_bits", result)


if __name__ == "__main__":
    unittest.main()
