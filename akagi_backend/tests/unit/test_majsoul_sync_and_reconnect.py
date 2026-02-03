import unittest
from unittest.mock import patch

from akagi_ng.bridge.majsoul.bridge import MajsoulBridge
from akagi_ng.bridge.majsoul.liqi import MsgType
from akagi_ng.core import NotificationCode
from akagi_ng.core.constants import MahjongConstants


class TestMajsoulSyncAndReconnect(unittest.TestCase):
    def setUp(self):
        self.bridge = MajsoulBridge()
        self.bridge.accountId = 12345
        self.bridge.seat = 0
        self.bridge.is_3p = False

    # --- Tests from test_liqi_sync_fix.py ---

    def test_parse_sync_game_camel_case_keys(self):
        """Test that parse_sync_game handles 'gameRestore' (camelCase) correctly."""
        # Mock input matching the log structure (camelCase keys from protobuf)
        msg_dict = {
            "data": {
                "gameRestore": {
                    # We leave actions empty to avoid protobuf decoding issues in this test
                    # checking snapshot presence is sufficient to prove we accessed 'gameRestore'
                    "actions": [],
                    "snapshot": {"dummy": "data"},
                }
            }
        }

        msgs = self.bridge._parse_sync_game_raw(msg_dict)

        # It should return at least one message for the snapshot.
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["type"], "sync_game")
        self.assertEqual(msgs[0]["snapshot"]["dummy"], "data")

    def test_parse_sync_game_fallback_snake_case_failure(self):
        """Verify that snake_case keys are no longer supported or ignored if we only check gameRestore."""
        msg_dict = {"data": {"game_restore": {"actions": [], "snapshot": {"dummy": "data"}}}}
        msgs = self.bridge._parse_sync_game_raw(msg_dict)
        # Should be empty as we expect 'gameRestore'
        self.assertEqual(len(msgs), 0)

    # --- Tests from test_bridge_snapshot_fix.py ---

    def test_extract_snapshot_hands_nested_structure(self):
        """Test that _extract_snapshot_hands correctly extracts hands from the nested players structure."""
        self.bridge.seat = 0

        # Mock standard 13-tile hand using keys expected by MS_TILE_2_MJAI_TILE
        hand_tiles = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"]

        # Real structure: snapshot -> players -> [player0...] -> hands -> [tiles...]
        snapshot = {
            "players": [
                {
                    "hands": hand_tiles,  # Seat 0
                    "ming": [],
                    "score": 25000,
                },
                {"hands": [], "score": 25000},  # Seat 1
                {"hands": [], "score": 25000},  # Seat 2
                {"hands": [], "score": 25000},  # Seat 3
            ]
        }

        tehais, my_tehais, _ = self.bridge._extract_snapshot_hands(snapshot)

        # Check if we got our hand back
        self.assertEqual(len(my_tehais), 13, "Should extract 13 tiles")
        self.assertNotEqual(my_tehais[0], "?", "Should interpret tiles correctly (not default to ?)")
        self.assertEqual(tehais[0], my_tehais, "Display tehais should match extracted hand")

    def test_extract_snapshot_fallback_missing_players(self):
        """Test graceful failure if 'players' key is missing or structure is malformed."""
        self.bridge.seat = 0
        snapshot = {"hands": ["1m"]}  # Old/Wrong structure

        _, my_tehais, _ = self.bridge._extract_snapshot_hands(snapshot)

        # Should return defaults
        self.assertEqual(my_tehais, ["?"] * MahjongConstants.TEHAI_SIZE)

    # --- Tests from test_majsoul_reconnect.py ---

    @patch("akagi_ng.bridge.majsoul.bridge.MajsoulBridge._parse_sync_game_raw")
    def test_reconnect_synthesize_start_kyoku(self, mock_parse_sync_game):
        """
        Verify that if syncGame lacks ActionNewRound but has a snapshot,
        start_kyoku is synthesized.
        """
        mock_actions = [
            # A random historical action that IS NOT ActionNewRound
            {
                "type": MsgType.Notify,
                "method": ".lq.ActionPrototype",
                "data": {
                    "name": "ActionDealTile",
                    "data": {"seat": 0, "tile": "1m"},
                },
            },
            # The snapshot message
            {
                "type": "sync_game",
                "snapshot": {
                    "ju": 0,  # East 1
                    "ben": 0,
                    "chang": 0,  # East wind
                    "doras": ["1m"],
                    "players": [
                        {"score": 25000},
                        {"score": 25000},
                        {"score": 25000},
                        {"score": 25000},
                    ],
                    "hands": ["1m", "2m", "3m"],
                    "index_player": 0,
                },
            },
        ]

        mock_parse_sync_game.return_value = mock_actions

        # Call _parse_sync_game with a dummy dict
        events = self.bridge._parse_sync_game({})

        # Expect:
        # 0: system_event GAME_SYNCING
        # 1: start_kyoku (Synthesized from snapshot!)
        # 2...: parsed actions

        self.assertEqual(events[0]["type"], "system_event")
        self.assertEqual(events[0]["code"], NotificationCode.GAME_SYNCING)

        self.assertEqual(events[1]["type"], "start_kyoku")
        self.assertEqual(events[1]["kyoku"], 1)  # ju=0 -> kyoku=1
        self.assertEqual(events[1]["scores"][0], 25000)
        self.assertEqual(events[1]["dora_marker"], "1m")

    @patch("akagi_ng.bridge.majsoul.bridge.MajsoulBridge._parse_sync_game_raw")
    def test_reconnect_existing_action_new_round(self, mock_parse_sync_game):
        """
        Verify that if ActionNewRound exists, we DO NOT synthesize start_kyoku from snapshot.
        """
        mock_actions = [
            {
                "type": MsgType.Notify,
                "method": ".lq.ActionPrototype",
                "data": {
                    "name": "ActionNewRound",  # It exists!
                    "data": {
                        "chang": 0,
                        "ju": 0,
                        "ben": 0,
                        "liqibang": 0,
                        "doras": ["1m"],
                        "scores": [25000] * 4,
                        "tiles": ["1m"] * 13,
                    },
                },
            },
            {"type": "sync_game", "snapshot": {"ju": 0}},
        ]
        mock_parse_sync_game.return_value = mock_actions

        events = self.bridge._parse_sync_game({})

        # Expect standard parsing:
        # 0: GAME_SYNCING
        # 1: start_kyoku (from ActionNewRound)
        # Should NOT see a second start_kyoku

        self.assertEqual(events[1]["type"], "start_kyoku")
        start_kyoku_count = sum(1 for e in events if e["type"] == "start_kyoku")
        self.assertEqual(start_kyoku_count, 1)

    @patch("akagi_ng.bridge.majsoul.bridge.MajsoulBridge._parse_sync_game_raw")
    def test_reconnect_3p_scores(self, mock_parse_sync_game):
        """
        Verify that in 3-player mode, missing ActionNewRound results in 35000 starting score
        when synthesizing start_kyoku from snapshot.
        """
        self.bridge.is_3p = True

        mock_actions = [
            {
                "type": "sync_game",
                "snapshot": {
                    "ju": 0,
                    "ben": 0,
                    "players": [
                        {"score": 35000},
                        {"score": 35000},
                        {"score": 35000},
                    ],
                    "hands": ["1m", "2m"],
                    "index_player": 0,
                },
            }
        ]

        mock_parse_sync_game.return_value = mock_actions

        events = self.bridge._parse_sync_game({})

        self.assertEqual(events[1]["type"], "start_kyoku")
        self.assertEqual(events[1]["scores"][0], 35000)
        # 3p mode should have 4 score entries (last one is 0)
        self.assertEqual(len(events[1]["scores"]), 4)
        self.assertEqual(events[1]["scores"][3], 0)

    @patch("akagi_ng.bridge.majsoul.bridge.MajsoulBridge._parse_sync_game_raw")
    def test_reconnect_with_invalid_snapshot_players_list(self, mock_parse_sync_game):
        """
        Refined test based on trace log observation:
        'Snapshot players list invalid or seat 0 out of bounds'
        Verify that even if snapshot players list is missing/invalid,
        we typically recover using default values for start_kyoku.
        """
        self.bridge.seat = 0

        # Simulate the scenario from log where extraction fails
        mock_actions = [
            {
                "type": "sync_game",
                "snapshot": {
                    "ju": 0,
                    "ben": 0,
                    "chang": 0,
                    "doras": ["1m"],
                    # "players": []  <-- Missing or empty players list
                    "hands": [],
                    "index_player": 0,
                },
            }
        ]

        mock_parse_sync_game.return_value = mock_actions

        # This should trigger the warning but NOT crash using defaults
        events = self.bridge._parse_sync_game({})

        # Check recovery
        self.assertEqual(events[0]["type"], "system_event")
        self.assertEqual(events[0]["code"], NotificationCode.GAME_SYNCING)

        # start_kyoku should still be synthesized with defaults
        start_kyoku = events[1]
        self.assertEqual(start_kyoku["type"], "start_kyoku")
        self.assertEqual(start_kyoku["scores"], [25000, 25000, 25000, 25000])  # Defaults
        self.assertEqual(start_kyoku["tehais"][0], ["?"] * 13)  # Default hands

    def test_reconnect_with_real_log_data(self):
        """
        Test with real log data from Line 515 where start_kyoku was missed.
        We use the actual ActionNewRound base64 data to verify parsing and event generation.
        """
        # This requires real parsing, so we don't mock parse_sync_game.
        # We rely on the project's liqi module.

        # Real base64 data from the log
        # ActionNewRound data
        b64_data = "CAAQABgAIgI5cCICNXoiAjdzIgI3eiICNHMiAjdwIgIycCICOXAiAjN6IgI3cCICOHMiAjV6IgI4cyICNnoyCbiRAriRAriRAjoMCAASAggBIAAomL8SQABYAGg2cgIyc3oCCAB6AggBegIIApoBQGQxMjI2MDQwYzY0N2RiNTM0NTA1NzU5NmFhNzE1OGUxMzZlYjk3NmEwYWE5YTViMzFhZWE3ZWIyODJlOGM3NziqAUA0ZjA4NGQ2YWViYTZlZmIxMDEzMTY4NjFmMzU0MWJiZjdlNDBiMzE0MDgzODA5MTUyNDBhMDRmMGYxZTM0MzU3"  # noqa: E501

        # Construct the msg_dict as if it came from the bridge
        msg_dict = {
            "data": {
                "gameRestore": {
                    "actions": [
                        {"name": "ActionMJStart", "step": 0, "data": ""},
                        {"step": 1, "name": "ActionNewRound", "data": b64_data},
                    ]
                }
            }
        }

        # IMPORTANT: validate that parse_sync_game works as expected
        # We need to ensure liqi imported in bridge is the one we are testing
        # The bridge instance uses self.liqi_proto, but parse_sync_game is a standalone function imported.

        # Call _parse_sync_game
        events = self.bridge._parse_sync_game(msg_dict)

        # Assertions
        # 1. system_event
        self.assertEqual(events[0]["type"], "system_event")
        self.assertEqual(events[0]["code"], NotificationCode.GAME_SYNCING)

        # 2. start_kyoku should be present!
        # If ActionNewRound parses correctly, we should get start_kyoku.
        self.assertGreater(len(events), 1, "Should have more than just system_event")
        self.assertEqual(events[1]["type"], "start_kyoku")
        self.assertEqual(len(events[1]["tehais"][self.bridge.seat]), 13)  # Hand tiles

        # 3. Tsumo event (since 14 tiles)
        self.assertEqual(events[2]["type"], "tsumo")

    def test_start_kyoku_immutability(self):
        """Test that start_kyoku event is not mutated by subsequent actions (Reference Bug Fix)."""
        self.bridge.is_3p = True
        self.bridge.seat = 0

        # 1. ActionNewRound with 13 tiles
        tiles = ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1s", "2s", "3s", "4s"]

        action_new_round = {
            "name": "ActionNewRound",
            "data": {
                "chang": 0,
                "ju": 0,
                "ben": 0,
                "liqibang": 0,
                "doras": ["1s"],
                "scores": [25000, 25000, 25000],
                "tiles": tiles,
            },
        }

        # Trigger New Round
        events = self.bridge._handle_action_new_round(action_new_round)
        start_kyoku_event = events[0]

        self.assertIn("1m", start_kyoku_event["tehais"][0])

        # 2. ActionDiscardTile (Discard 1m)
        action_discard = {
            "name": "ActionDiscardTile",
            "data": {
                "seat": 0,
                "tile": "1m",  # discard 1m
                "moqie": False,
                "isLiqi": False,
            },
        }

        # Trigger Discard
        # This will remove 1m from self.my_tehais
        self.bridge._handle_action_discard_tile(action_discard)

        # 3. Assert Mutated or Not
        # If bug exists, 1m will be missing from start_kyoku_event
        self.assertIn(
            "1m",
            start_kyoku_event["tehais"][0],
            "ActionNewRound event was mutated by subsequent discard! 1m should still be there.",
        )


if __name__ == "__main__":
    unittest.main()
