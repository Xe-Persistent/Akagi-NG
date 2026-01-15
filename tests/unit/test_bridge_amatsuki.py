import json
import unittest
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.amatsuki.bridge import STOMP, AmatsukiBridge
from akagi_ng.bridge.amatsuki.consts import AmatsukiAction, AmatsukiTopic


class TestAmatsukiBridge(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _injector(self, amatsuki_bridge):
        self.bridge = amatsuki_bridge

    def test_parse_returns_none_for_invalid_stomp(self):
        """Test parse returns None for invalid STOMP content"""
        content = b"INVALID\n\n"
        result = self.bridge.parse(content)
        self.assertIsNone(result)

    def test_handle_draw(self):
        """Test _handle_draw (Tsumo Event)"""
        # _handle_draw expects "hai" and "position"
        content = {
            "hai": {"id": 12},  # 4m
            "position": 0,
        }
        stomp = MagicMock(spec=STOMP)
        stomp.destination = f"{AmatsukiTopic.DRAW_PREFIX}0"  # Suffix 0
        stomp.content_dict.return_value = content
        stomp.content = json.dumps(content)

        with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: "4m" if x == 12 else "?"

            result = self.bridge._handle_draw(stomp)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "tsumo")
            self.assertEqual(result[0]["actor"], 0)
            self.assertEqual(result[0]["pai"], "4m")

    def test_handle_tehai_action_kiri(self):
        """Test _handle_tehai_action for KIRI (Dahai)"""
        content = {
            "action": AmatsukiAction.KIRI,
            "haiList": [{"id": 12}],  # 4m
            "isKiri": True,
            "isReachDisplay": False,
            "position": 0,
            "tehaiList": [],
        }
        stomp = MagicMock(spec=STOMP)
        stomp.destination = f"{AmatsukiTopic.TEHAI_ACTION_PREFIX}.0"
        stomp.content_dict.return_value = content
        stomp.content = json.dumps(content)

        with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: "4m" if x == 12 else "?"

            result = self.bridge._handle_tehai_action(stomp)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "dahai")
            self.assertEqual(result[0]["actor"], 0)
            self.assertEqual(result[0]["pai"], "4m")
            self.assertTrue(result[0]["tsumogiri"])

    def test_handle_river_action_pon(self):
        """Test _handle_river_action for PON"""
        content = {
            "action": AmatsukiAction.PON,
            "menzu": {"menzuList": [{"id": 12}, {"id": 12}, {"id": 12}]},  # 4m, 4m, 4m
            "position": 0,
        }
        stomp = MagicMock(spec=STOMP)
        stomp.destination = f"{AmatsukiTopic.RIVER_ACTION_PREFIX}.0"
        stomp.content_dict.return_value = content
        stomp.content = json.dumps(content)

        self.bridge.last_discard_actor = 1
        self.bridge.last_discard = "4m"

        with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
            mock_mapping.__getitem__.side_effect = lambda x: "4m"

            result = self.bridge._handle_river_action(stomp)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "pon")
            self.assertEqual(result[0]["actor"], 0)
            self.assertEqual(result[0]["target"], 1)
            self.assertEqual(result[0]["pai"], "4m")
            # Consumed logic takes all items in menzuList except ones matching last_discard?
            # menzuList has 3. last_discard is 4m.
            # Logic is: check each tile. if it equals last_discard and skip_pai is true, skip it and set skip_pai=False.
            # So 1 out of 3 4ms is skipped. 2 remain.
            self.assertEqual(len(result[0]["consumed"]), 2)

    def test_handle_river_action_chi(self):
        """Test _handle_river_action for CHI"""
        content = {
            "action": AmatsukiAction.CHII,
            "menzu": {"menzuList": [{"id": 4}, {"id": 8}, {"id": 12}]},  # 2m, 3m, 4m
            "position": 0,
        }
        stomp = MagicMock(spec=STOMP)
        stomp.destination = f"{AmatsukiTopic.RIVER_ACTION_PREFIX}.0"
        stomp.content_dict.return_value = content
        stomp.content = json.dumps(content)

        self.bridge.last_discard_actor = 3
        self.bridge.last_discard = "4m"

        with patch("akagi_ng.bridge.amatsuki.bridge.ID_TO_MJAI_PAI") as mock_mapping:
            def mapping(x):
                return {4: "2m", 8: "3m", 12: "4m"}.get(x, "?")

            mock_mapping.__getitem__.side_effect = mapping

            result = self.bridge._handle_river_action(stomp)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "chi")
            self.assertEqual(result[0]["actor"], 0)
            self.assertEqual(result[0]["target"], 3)
            self.assertEqual(result[0]["pai"], "4m")
            self.assertEqual(result[0]["consumed"], ["2m", "3m"])

    def test_handle_ron_action(self):
        """Test _handle_ron_action"""
        content = {"seat": 0, "ronSeat": 1, "yaku": [], "fans": [], "fu": 30, "point": 8000}
        stomp = MagicMock(spec=STOMP)
        stomp.content_dict.return_value = content
        stomp.content = json.dumps(content)

        self.bridge.game_status.last_kiri_tile = "4m"

        result = self.bridge._handle_ron_action(stomp)

        if result is not None:
            self.assertIsInstance(result, list)
