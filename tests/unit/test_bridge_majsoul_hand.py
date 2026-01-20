"""
MajsoulBridge Hand Tracking Unit Tests
"""

import sys
import unittest
from pathlib import Path

# 添加项目根目录到 sys.path
sys.path.append(str(Path(__file__).parent.parent.parent))

from akagi_ng.bridge.majsoul import MajsoulBridge
from akagi_ng.bridge.majsoul.liqi import MsgType


class TestMajsoulBridgeHandTracking(unittest.TestCase):
    def setUp(self):
        self.bridge = MajsoulBridge()
        self.bridge.seat = 0

    def test_hand_tracking_new_round(self):
        """Test hand initialization on new round."""
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionNewRound",
                "data": {
                    "chang": 0,
                    "jushu": 0,
                    "ju": 0,
                    "ben": 0,
                    "liqibang": 0,
                    "doras": ["1m"],
                    "scores": [25000, 25000, 25000, 25000],
                    "tiles": ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "1z", "2z", "3z", "4z"],
                },
            },
        }
        self.bridge.parse_liqi(liqi_message)

        expected_hand = ["1m", "2m", "3m", "4p", "5p", "6p", "7s", "8s", "9s", "E", "S", "W", "N"]
        # Note: 1z..4z map to E, S, W, N
        self.assertEqual(len(self.bridge.my_tehais), 13)
        self.assertEqual(self.bridge.my_tehais, expected_hand)
        self.assertIsNone(self.bridge.my_tsumohai)

    def test_hand_tracking_deal_tile(self):
        """Test hand update on deal tile."""
        # Initialize hand first
        self.bridge.my_tehais = ["1m"] * 13

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDealTile",
                "data": {"seat": 0, "tile": "5m", "leftTileCount": 60},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertEqual(self.bridge.my_tsumohai, "5m")

    def test_hand_tracking_discard_tsumogiri(self):
        """Test discard (tsumogiri)."""
        self.bridge.my_tehais = ["1m"] * 13
        self.bridge.my_tsumohai = "5m"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {"seat": 0, "tile": "5m", "isLiqi": False, "moqie": True},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_discard_tedashi_tsumo(self):
        """Test discard from hand, keeping tsumo."""
        # Hand: 123m, Tsumo: 9m. Discard 1m. Result: 239m
        self.bridge.my_tehais = ["1m", "2m", "3m"] + ["1z"] * 10
        self.bridge.my_tsumohai = "9m"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionDiscardTile",
                "data": {"seat": 0, "tile": "1m", "isLiqi": False, "moqie": False},
            },
        }
        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertNotIn("1m", self.bridge.my_tehais)
        self.assertIn("9m", self.bridge.my_tehais)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_chi(self):
        """Test hand update after Chi."""
        # Hand: 2m 3m 4m ...
        # Chi 4m (using 2m 3m from hand)
        self.bridge.my_tehais = ["2m", "3m", "4m", "5m"] + ["1z"] * 9

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 0,
                    "type": 0,  # Chi
                    "tiles": [
                        "2m",
                        "3m",
                        "4m",
                    ],  # MJAI logic: tiles[0,1] from hand? Wait, implementation uses raw matching
                    "froms": [1, 0, 0],  # 4m from seat 1, 2m 3m from seat 0
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertNotIn("3m", self.bridge.my_tehais)
        self.assertNotIn("4m", self.bridge.my_tehais)
        self.assertIn("2m", self.bridge.my_tehais)  # The original 2m
        self.assertIn("5m", self.bridge.my_tehais)

    def test_hand_tracking_ankan(self):
        """Test hand update after Ankan."""
        self.bridge.my_tehais = ["5m", "5m", "5m", "5mr"] + ["1z"] * 9  # 0m is 5mr
        self.bridge.my_tsumohai = "9m"  # Irrelevant tsumo

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionAnGangAddGang",
                "data": {
                    "seat": 0,
                    "type": 3,  # AnKan
                    "tiles": "0m",  # Indication of the kan
                },
            },
        }

        # 0m -> 5mr.
        # Logic: consumed=["5m", "5m", "5m", "5mr"] (handled in _handle logic)
        # Should remove all 4.

        self.bridge.parse_liqi(liqi_message)

        self.assertNotIn("5m", self.bridge.my_tehais)
        self.assertNotIn("5mr", self.bridge.my_tehais)

        self.assertEqual(self.bridge.my_tsumohai, "9m")
        self.assertEqual(len(self.bridge.my_tehais), 9)


if __name__ == "__main__":
    unittest.main()
