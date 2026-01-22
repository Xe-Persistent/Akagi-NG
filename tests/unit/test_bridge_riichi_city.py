import unittest
from unittest.mock import patch

import pytest

from akagi_ng.bridge.riichi_city.bridge import RCMessage
from akagi_ng.bridge.riichi_city.consts import RCAction
from akagi_ng.core.constants import MahjongConstants


class TestRiichiCityBridge(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _injector(self, riichi_city_bridge):
        self.bridge = riichi_city_bridge

    def test_handle_in_card_brc(self):
        """Test _handle_in_card_brc (Draw Tile)"""
        # "card" in msg_data
        msg_data = {
            "data": {
                "user_id": 1001,
                "card": "1m",  # Need to know CARD2MJAI mapping or mock it.
                # Assuming simple string input for mock if we patch CARD2MJAI
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: x

            result = self.bridge._handle_in_card_brc(rc_msg)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "tsumo")
            self.assertEqual(result[0]["actor"], 1)
            self.assertEqual(result[0]["pai"], "1m")

    def test_handle_game_action_brc_dahai(self):
        """Test _handle_game_action_brc for DAHAI"""
        # action_info is a list of actions
        msg_data = {
            "data": {
                "action_info": [
                    {
                        "action": RCAction.DAHAI_REACH,
                        "user_id": 1001,
                        "card": "1m",
                        "move_cards_pos": [MahjongConstants.TSUMO_TEHAI_SIZE],  # Tsumogiri check
                        "is_li_zhi": False,
                    }
                ]
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: x

            result = self.bridge._handle_game_action_brc(rc_msg)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "dahai")
            self.assertEqual(result[0]["actor"], 1)
            self.assertEqual(result[0]["pai"], "1m")
            self.assertTrue(result[0]["tsumogiri"])

    def test_handle_game_action_brc_pon(self):
        """Test _handle_game_action_brc for PON"""
        # Prerequisite
        self.bridge.game_status.last_dahai_actor = 0

        msg_data = {
            "data": {
                "action_info": [{"action": RCAction.PON, "user_id": 1001, "card": "1m", "group_cards": ["1m", "1m"]}]
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: x

            result = self.bridge._handle_game_action_brc(rc_msg)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "pon")
            self.assertEqual(result[0]["actor"], 1)
            self.assertEqual(result[0]["target"], 0)
            self.assertEqual(result[0]["pai"], "1m")
            self.assertEqual(result[0]["consumed"], ["1m", "1m"])

    def test_handle_game_action_brc_chi(self):
        """Test _handle_game_action_brc for CHI"""
        self.bridge.game_status.last_dahai_actor = 0  # Left player relative to 1

        msg_data = {
            "data": {
                "action_info": [
                    {
                        "action": RCAction.CHI_LOW,  # or MID/HIGH
                        "user_id": 1001,
                        "card": "3m",
                        "group_cards": ["1m", "2m"],
                    }
                ]
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: x

            result = self.bridge._handle_game_action_brc(rc_msg)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "chi")
            self.assertEqual(result[0]["actor"], 1)
            self.assertEqual(result[0]["target"], 0)  # actor=1, target=(1-1)%4=0
            self.assertEqual(result[0]["pai"], "3m")
            self.assertEqual(result[0]["consumed"], ["1m", "2m"])

    def test_handle_game_action_brc_ron(self):
        """Test _handle_game_action_brc for RON"""
        msg_data = {
            "data": {
                "action_info": [
                    {
                        "action": RCAction.HORA,  # Or RON_TSUMO
                        "user_id": 1001,
                    }
                ]
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        result = self.bridge._handle_game_action_brc(rc_msg)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "end_kyoku")

    def test_handle_game_action_brc_reach(self):
        """Test _handle_game_action_brc for REACH"""
        msg_data = {
            "data": {
                "action_info": [
                    {
                        "action": RCAction.DAHAI_REACH,
                        "user_id": 1001,
                        "card": "1m",
                        "move_cards_pos": [0],  # Not tsumogiri
                        "is_li_zhi": True,
                    }
                ]
            }
        }
        rc_msg = RCMessage(1, 1, msg_data)

        with patch("akagi_ng.bridge.riichi_city.bridge.CARD2MJAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: x

            result = self.bridge._handle_game_action_brc(rc_msg)

            # Expect reach then dahai
            self.assertEqual(len(result), 2)
            self.assertEqual(result[0]["type"], "reach")
            self.assertEqual(result[0]["actor"], 1)

            self.assertEqual(result[1]["type"], "dahai")
            self.assertEqual(result[1]["pai"], "1m")

            # Check side effect: accept_reach is set
            self.assertIsNotNone(self.bridge.game_status.accept_reach)
            self.assertEqual(self.bridge.game_status.accept_reach["type"], "reach_accepted")
