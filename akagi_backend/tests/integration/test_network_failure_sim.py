import json
import unittest
from unittest.mock import MagicMock, patch

from akagi_ng.bridge.majsoul.bridge import MajsoulBridge, MsgType
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.mortal.base import MortalBot

# Real Liqi payloads extracted from logs/akagi_20260201_162626.log
LIQI_LOG_DATA = {
    "authGame_req": {
        "id": 26,
        "type": MsgType.Req.value,
        "method": ".lq.FastTest.authGame",
        "data": {
            "accountId": 10000,
            "token": "test-token-123",
            "gameUuid": "test-game-uuid-456",
        },
    },
    "authGame_res": {
        "id": 26,
        "type": MsgType.Res.value,
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
    "syncGame_req": {
        "id": 27,
        "type": MsgType.Req.value,
        "method": ".lq.FastTest.syncGame",
        "data": {"roundId": "0-0-0", "step": 4294967295},
    },
    "syncGame_res": {
        "id": 27,
        "type": MsgType.Res.value,
        "method": ".lq.FastTest.syncGame",
        "data": {
            "step": 24,
            "gameRestore": {
                "actions": [
                    {"name": "ActionMJStart", "step": 0, "data": ""},
                    {
                        "step": 1,
                        "name": "ActionNewRound",
                        "data": "CAAQABgAIgI1cyICM3AiAjZwIgI3cyICN3AiAjhzIgIxeiICN3oiAjFzIgI5cyICMnMiAjVwIgI2ejIJuJECuJECuJECQABYAGg2cgI0cHoCCAB6AggBegIIApoBQGQwYzUwZDlmNjIzYzI3OTdlYzk1M2ExMDRhYmNlYzkxNDk5OTQ1YzU1MDY3OGI5MGYwOGUxNWY1NGQ0NDAwMDOqAUBjYjE3YWIzOTM1NTcwMzA1M2M0NTE0ZTM0Y2E0NDU4ZTdhNWQ3ZTNmMjZiNzdmZGFiMGFjMjc1NzVhNmRhMjQw",
                    },
                    {"step": 2, "name": "ActionDiscardTile", "data": "CAASAjV6GAAoADAASAA="},
                    {"step": 3, "name": "ActionDealTile", "data": "CAESAjVwGDUiDAgBEgIIASAAKOCnEjgA"},
                    {"step": 4, "name": "ActionDiscardTile", "data": "CAESAjF6GAAoADAASAA="},
                    {"step": 5, "name": "ActionDealTile", "data": "CAIYNDgA"},
                    {"step": 6, "name": "ActionBaBei", "data": "CAJIAQ=="},
                    {"step": 7, "name": "ActionDealTile", "data": "CAIYMzICNHA4AA=="},
                    {"step": 8, "name": "ActionDiscardTile", "data": "CAISAjlzGAAoATAASAA="},
                    {"step": 9, "name": "ActionDealTile", "data": "CAAYMjgA"},
                    {"step": 10, "name": "ActionDiscardTile", "data": "CAASAjZzGAAoATAASAA="},
                    {"step": 11, "name": "ActionDealTile", "data": "CAESAjFtGDEiDAgBEgIIASAAKOCnEjgA"},
                    {"step": 12, "name": "ActionDiscardTile", "data": "CAESAjFtGAAoATAASAA="},
                    {"step": 13, "name": "ActionDealTile", "data": "CAIYMDgA"},
                    {"step": 14, "name": "ActionDiscardTile", "data": "CAISAjRzGAAoATAASAA="},
                    {"step": 15, "name": "ActionDealTile", "data": "CAAYLzgA"},
                    {"step": 16, "name": "ActionDiscardTile", "data": "CAASAjhzGAAoADAASAA="},
                    {"step": 17, "name": "ActionDealTile", "data": "CAESAjhwGC4iDAgBEgIIASAAKOCnEjgA"},
                    {"step": 18, "name": "ActionDiscardTile", "data": "CAESAjd6GAAoADAASAA="},
                    {"step": 19, "name": "ActionDealTile", "data": "CAIYLTgA"},
                    {"step": 20, "name": "ActionDiscardTile", "data": "CAISAjZ6GAAoADAASAA="},
                    {"step": 21, "name": "ActionDealTile", "data": "CAAYLDgA"},
                    {"step": 22, "name": "ActionDiscardTile", "data": "CAASAjd6GAAoATAASAA="},
                    {
                        "step": 23,
                        "name": "ActionDealTile",
                        "data": "CAESAjNwGCsiDAgBEgIIASAAKOCnEjgA",
                    },
                ],
                "gameState": 1,
            },
            "isEnd": False,
        },
    },
}


class TestNetworkFailures(unittest.TestCase):
    def setUp(self):
        # We need a real Bridge to parse Liqi messages
        self.bridge = MajsoulBridge()

        # Mock EngineProvider
        self.mock_engine_provider = MagicMock(spec=EngineProvider)
        self.mock_online_engine = MagicMock()
        self.mock_local_engine = MagicMock()
        self.mock_engine_provider.online_engine = self.mock_online_engine
        self.mock_engine_provider.local_engine = self.mock_local_engine
        self.mock_engine_provider.fallback_active = False

        # Instantiate MortalBot
        self.bot = MortalBot(
            engine=self.mock_engine_provider,
        )

        # Create a mock model loader that returns a MockModel and our self.mock_engine_provider
        self.mock_model = MagicMock()

        # Mock react to call engine.react_batch if needed, or just return dummy json
        def mock_react_side_effect(json_event):
            events = json.loads(json_event)
            # Handle both list and single dict for robustness in mock, though bot expects list
            if isinstance(events, dict):
                events = [events]

            for event in events:
                if event["type"] in ["tsumo", "chi", "pon", "daiminkan"]:  # Events requiring response
                    try:
                        # Mock params for react_batch
                        # Dynamically use the current engine assigned to the bot
                        current_engine = self.bot.engine
                        if current_engine:
                            current_engine.react_batch([0], [0], [0], options={"is_sync": False})
                        else:
                            pass
                    except Exception:
                        # expected failure for fallback test
                        pass

            meta = {"q_values": [], "mask_bits": 0}
            # If trigger flag is set, return meta that includes q_values/mask_bits.
            # MortalBot checks these existence before calling meta_to_recommend.
            if self.should_trigger_reach:
                meta = {"q_values": [0.0] * 46, "mask_bits": 1}

            return json.dumps({"type": "none", "meta": meta})

        self.mock_model.react.side_effect = mock_react_side_effect

        def mock_loader(player_id, is_3p):
            return self.mock_model, self.mock_engine_provider

        self.bot.model_loader = mock_loader

        # Initialize accountId for Bridge by parsing req
        # This prevents ValueError: 0 is not in list during authGame_res parsing
        if "authGame_req" in LIQI_LOG_DATA:
            self.bridge.parse_liqi(LIQI_LOG_DATA["authGame_req"])

        self.should_trigger_reach = False

        # Mock LookaheadBot and meta_to_recommend to verify lookahead
        self.lookahead_patcher = patch("akagi_ng.mjai_bot.mortal.base.LookaheadBot")
        self.mock_lookahead_cls = self.lookahead_patcher.start()
        self.mock_lookahead_instance = self.mock_lookahead_cls.return_value
        self.mock_lookahead_instance.simulate_reach.return_value = {
            "q_values": [0.0] * 46,  # dummy
            "mask_bits": 123,  # dummy
        }

        self.meta_recommend_patcher = patch("akagi_ng.mjai_bot.utils.meta_to_recommend")
        self.mock_meta_recommend = self.meta_recommend_patcher.start()

        def side_effect_recommend(meta, is_3p):
            if self.should_trigger_reach:
                return [("reach", 0.99), ("dahai", 0.1)]
            return []

        self.mock_meta_recommend.side_effect = side_effect_recommend

    def tearDown(self):
        self.lookahead_patcher.stop()
        self.meta_recommend_patcher.stop()

    def _verify_lookahead(self):
        """Helper to verify Riichi Lookahead execution"""
        print("    Verifying Riichi Lookahead execution...")
        self.should_trigger_reach = True
        self.mock_lookahead_instance.simulate_reach.reset_mock()

        # Trigger an event that requires reaction
        self.bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "5m"}]))

        self.mock_lookahead_instance.simulate_reach.assert_called_once()
        print("    Riichi Lookahead verified.")
        self.should_trigger_reach = False

    def test_game_reconnect(self):
        """
        Scenario 1: Game Disconnect/Reconnect using Real Liqi Data
        Simulate the exact flow found in logs:
        1. authGame (Join) -> start_game
        2. syncGame (Reconnect) -> start_kyoku + catch-up events
        """
        print("[Test] Game Disconnect/Reconnect (Real Data)")

        # 1. Simulate Auth Game (Initial Join logic, though normally happens before sync)
        print("  Sending authGame...")
        mjai_events_auth = self.bridge.parse_liqi(LIQI_LOG_DATA["authGame_res"])
        if mjai_events_auth:
            # Wrap events in list for MortalBot
            self.bot.react(json.dumps(mjai_events_auth))

        # 2. Simulate Sync Game (Reconnect)
        print("  Sending syncGame (Reconnect)...")

        # Mocking `_parse_sync_game` to return the reconstructed event list from log
        expected_mjai_restore = [
            {"type": "system_event", "code": "game_syncing"},
            {
                "type": "start_kyoku",
                "bakaze": "E",
                "dora_marker": "4p",
                "kyoku": 1,
                "honba": 0,
                "kyotaku": 0,
                "oya": 0,
                "scores": [35000, 35000, 35000, 0],
                "tehais": [["?"], ["?"], ["?"], ["?"]],  # Simplified
                "is_3p": True,
                "sync": True,
            },
            # ... add a few actions ...
            {"type": "dahai", "actor": 0, "pai": "P", "tsumogiri": False, "sync": True},
            {"type": "tsumo", "actor": 1, "pai": "5p", "sync": True},
        ]

        with patch.object(self.bridge, "_parse_sync_game", return_value=expected_mjai_restore):
            mjai_events_sync = self.bridge.parse_liqi(LIQI_LOG_DATA["syncGame_res"])

            # Use the mocked return
            if mjai_events_sync:
                # Wrap events in list for MortalBot
                self.bot.react(json.dumps(mjai_events_sync))

            # Verification
            self._verify_lookahead()
            print("  Reconnect processed successfully.")

    def test_online_fallback_real_error(self):
        """
        Scenario 2: Online Model Fallback with Real Error
        Simulate `AttributeError: 'list' object has no attribute 'shape'`
        found in logs when calling online engine.
        """
        print("[Test] Online Model Fallback (Real Error)")

        # 1. Setup Provider
        real_provider = EngineProvider(
            online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=True
        )

        # 2. Simulate exact error from log
        error_msg = "'list' object has no attribute 'shape'"
        self.mock_online_engine.react_batch.side_effect = AttributeError(error_msg)

        # Mock local engine success
        success_return = ([0], [[0.1] * 14], [[False] * 14], [True])
        self.mock_local_engine.react_batch.return_value = success_return

        # Inject provider into bot
        # IMPORTANT: Set model and player_id manually as we skip authGame/startGame
        self.bot.engine = real_provider
        self.bot.model = self.mock_model
        self.bot.player_id = 0

        # 3. Trigger Bot Action
        event = {"type": "tsumo", "actor": 0, "pai": "1m"}
        print("  Triggering reaction with malformed response error...")

        # Wrap event in list
        self.bot.react(json.dumps([event]))

        # 4. Verify Fallback
        self.assertTrue(
            real_provider.fallback_active,
            "Fallback should be active after online failure",
        )
        self.mock_local_engine.react_batch.assert_called_once()
        self._verify_lookahead()
        print("  Fallback logic handled AttributeError correctly.")

    def test_online_recovery(self):
        """
        Scenario 3: Online Model Recovery
        Fail once, then succeed next time.
        """
        print("[Test] Online Model Recovery")

        real_provider = EngineProvider(
            online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=True
        )

        # First call fails, Second call succeeds
        success_return = ([0], [[0.1] * 14], [[False] * 14], [True])
        self.mock_online_engine.react_batch.side_effect = [
            Exception("Timeout"),
            success_return,
        ]
        self.mock_local_engine.react_batch.return_value = success_return

        # Override loader to use this specific engine provider
        self.bot.model_loader = lambda p, is_3p: (self.mock_model, real_provider)

        self.bot.engine = real_provider
        self.bot.model = self.mock_model  # Need model to react
        self.bot.player_id = 0  # Need player_id to react

        # Start game (Simulated simple start)
        # We already set model/player manually, so start_game might overwrite/reset history
        # But let's keep it consistent
        self.bot.react(json.dumps([{"type": "start_game", "id": 0}]))
        self.bot.react(
            json.dumps(
                [
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
                    }
                ]
            )
        )

        # 1. Failure -> Fallback
        print("  Triggering 1st reaction (Failure)...")
        # Wrap in list
        self.bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "1m"}]))
        self.assertTrue(real_provider.fallback_active, "Should be in fallback mode")
        self.mock_local_engine.react_batch.assert_called()

        # 2. Success -> Recovery
        print("  Triggering 2nd reaction (Success)...")
        # Reset local engine mock to ensure it's not called this time
        self.mock_local_engine.react_batch.reset_mock()

        # We need a new event to trigger another reaction
        # Wrap in list
        self.bot.react(json.dumps([{"type": "tsumo", "actor": 0, "pai": "2m"}]))

        self.assertFalse(
            real_provider.fallback_active,
            "Fallback should be inactive after online success",
        )
        # Local engine should NOT be called if online succeeds
        self.mock_local_engine.react_batch.assert_not_called()
        self._verify_lookahead()
        print("  Recovery successfully verified.")

    def test_simultaneous_fallback_and_reconnect(self):
        """
        Scenario 4: Simultaneous Fallback & Reconnect
        Simulate a worst-case scenario:
        1. User disconnects.
        2. Upon reconnect (syncGame), the Online Engine FAILS immediately.
        3. Expect system to handle reconnect logic AND fallback to local engine seamlessly.
        """
        print("[Test] Simultaneous Fallback & Reconnect")

        with patch.object(self.bridge, "_parse_sync_game") as mock_parse_sync:
            # 1. Setup Provider with failing Online Engine
            real_provider = EngineProvider(
                online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=True
            )

            # Simulate Online Engine Failure
            self.mock_online_engine.react_batch.side_effect = Exception("Simultaneous Network Failure")

            # Mock local engine success
            success_return = ([0], [[0.1] * 14], [[False] * 14], [True])
            self.mock_local_engine.react_batch.return_value = success_return

            self.mock_local_engine.react_batch.return_value = success_return

            # Override loader to use this specific engine provider
            self.bot.model_loader = lambda p, is_3p: (self.mock_model, real_provider)

            self.bot.engine = real_provider
            self.bot.model = self.mock_model  # Need model to react

            # 2. Simulate Auth Game (Join)
            mjai_events_auth = self.bridge.parse_liqi(LIQI_LOG_DATA["authGame_res"])
            if mjai_events_auth:
                # Wrap in list
                self.bot.react(json.dumps(mjai_events_auth))

            # 3. Simulate Sync Game (Reconnect) with mocked return events
            # Crucially, 'tsumo' events here will trigger the bot to think/react.
            expected_mjai_restore = [
                {"type": "system_event", "code": "game_syncing"},
                {
                    "type": "start_kyoku",
                    "bakaze": "E",
                    "dora_marker": "4p",
                    "kyoku": 1,
                    "honba": 0,
                    "kyotaku": 0,
                    "oya": 0,
                    "scores": [35000, 35000, 35000, 0],
                    "tehais": [["?"], ["?"], ["?"], ["?"]],
                    "is_3p": True,
                    "sync": True,
                },
                # Trigger an action that requires engine response immediately after sync
                {"type": "tsumo", "actor": 0, "pai": "5p", "sync": True},
            ]
            mock_parse_sync.return_value = expected_mjai_restore

            print("  Sending syncGame (Reconnect) with Failing Online Engine...")
            mjai_events_sync = self.bridge.parse_liqi(LIQI_LOG_DATA["syncGame_res"])

            if mjai_events_sync:
                # Wrap in list
                self.bot.react(json.dumps(mjai_events_sync))

            # 4. Verification
            # Check if fallback mode was activated
            self.assertTrue(
                real_provider.fallback_active,
                "Fallback should be active after online failure during reconnect",
            )

            # Check if local engine was used for the 'tsumo' event
            self.mock_local_engine.react_batch.assert_called()
            self._verify_lookahead()
            print("  Simultaneous Fallback & Reconnect handled successfully.")


if __name__ == "__main__":
    unittest.main()
