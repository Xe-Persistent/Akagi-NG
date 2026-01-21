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

        # Fix: Ankan triggers a new DealTile (Rinshan).
        # The previous tsumohai ("9m") must be moved to hand to prevent overwrite.
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertIn("9m", self.bridge.my_tehais)
        self.assertEqual(len(self.bridge.my_tehais), 10)  # 9 original + 1 moved tsumo

    def test_hand_tracking_nukidora_tsumo(self):
        """Test Nukidora (Kita) when the tile is tsumohai."""
        self.bridge.my_tehais = ["1m"] * 13
        self.bridge.my_tsumohai = "N"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 0,
                    "moqie": False,
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # Should consume tsumohai
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertEqual(len(self.bridge.my_tehais), 13)

    def test_hand_tracking_nukidora_save_previous_tsumo(self):
        """Test Nukidora (Kita) saves previous tsumohai if not consumed."""
        # Initial: 13 tiles + tsumo '3s'.
        # Action: Nukidora 'N' (from tehai).
        # Expectation: '3s' moves to tehai. 'N' removed from tehai.
        self.bridge.my_tehais = ["1m"] * 12 + ["N"]
        self.bridge.my_tsumohai = "3s"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionBaBei",
                "data": {
                    "seat": 0,
                    "moqie": False,
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # 'N' should be removed from tehai
        self.assertNotIn("N", self.bridge.my_tehais)
        self.assertIn("3s", self.bridge.my_tehais)
        self.assertIsNone(self.bridge.my_tsumohai)

    def test_hand_tracking_daiminkan_save_tsumo(self):
        """Test Daiminkan saves tsumohai before consuming tiles."""
        # Setup: 13 tiles in hand + tsumo
        self.bridge.my_tehais = ["5p", "5p", "5p"] + ["1z"] * 10
        self.bridge.my_tsumohai = "3s"

        # Daiminkan: consume 3x5p from hand + 1x5p from opponent
        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 0,
                    "type": 2,  # Gang (Daiminkan)
                    "tiles": ["5p", "5p", "5p", "5p"],
                    "froms": [1, 0, 0, 0],  # 5p from seat 1, rest from seat 0
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        # tsumohai should be saved to hand
        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertIn("3s", self.bridge.my_tehais)
        # 5p should be removed
        self.assertNotIn("5p", self.bridge.my_tehais)
        # Final count: 10 '1z' + 1 '3s' = 11
        self.assertEqual(len(self.bridge.my_tehais), 11)

    def test_hand_tracking_pon_save_tsumo(self):
        """Test Pon saves tsumohai before consuming tiles."""
        self.bridge.my_tehais = ["7s", "7s"] + ["1z"] * 11
        self.bridge.my_tsumohai = "9m"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 0,
                    "type": 1,  # Peng (Pon)
                    "tiles": ["7s", "7s", "7s"],
                    "froms": [2, 0, 0],  # 7s from seat 2, rest from seat 0
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertIn("9m", self.bridge.my_tehais)
        self.assertNotIn("7s", self.bridge.my_tehais)
        # 11 '1z' + 1 '9m' = 12
        self.assertEqual(len(self.bridge.my_tehais), 12)

    def test_hand_tracking_chi_save_tsumo(self):
        """Test Chi saves tsumohai before consuming tiles."""
        self.bridge.my_tehais = ["2m", "3m"] + ["1z"] * 11
        self.bridge.my_tsumohai = "5pr"

        liqi_message = {
            "method": ".lq.ActionPrototype",
            "type": MsgType.Notify,
            "data": {
                "name": "ActionChiPengGang",
                "data": {
                    "seat": 0,
                    "type": 0,  # Chi
                    "tiles": ["1m", "2m", "3m"],
                    "froms": [3, 0, 0],  # 1m from seat 3, rest from seat 0
                },
            },
        }

        self.bridge.parse_liqi(liqi_message)

        self.assertIsNone(self.bridge.my_tsumohai)
        self.assertIn("5pr", self.bridge.my_tehais)
        self.assertNotIn("2m", self.bridge.my_tehais)
        self.assertNotIn("3m", self.bridge.my_tehais)
        # 11 '1z' + 1 '5pr' = 12
        self.assertEqual(len(self.bridge.my_tehais), 12)


if __name__ == "__main__":
    unittest.main()
