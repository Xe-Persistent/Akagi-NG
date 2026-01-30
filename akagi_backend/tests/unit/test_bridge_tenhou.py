import unittest
from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.bridge.tenhou.utils.decoder import Meld


class TestTenhouBridge(unittest.TestCase):
    @pytest.fixture(autouse=True)
    def _injector(self, tenhou_bridge):
        self.bridge = tenhou_bridge

    def test_convert_start_game(self):
        """Test _convert_start_game (TAIKYOKU)"""
        # oya=0 (Dealer is seat 0) -> Player 0 is Dealer. seat=0.
        message = {"tag": "TAIKYOKU", "oya": "0"}

        result = self.bridge._convert_start_game(message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "start_game")
        # Logic: self.state.seat = (4 - 0) % 4 = 0.
        # But wait, TAIKYOKU sets self.state.seat based on oya?
        # The logic in bridge is:
        # self.state.seat = (MahjongConstants.SEATS_4P - int(message["oya"])) % MahjongConstants.SEATS_4P
        # This implies it assumes we are always relative to oya 0?
        # No, Tenhou logs usually use absolute seat 0 as "User". But verifying logic:
        # If oya is 1. (4-1)%4 = 3. Seat becomes 3.
        pass

    def test_convert_tsumo(self):
        """Test _convert_tsumo (T...)"""
        # T132 -> Draw tile 132
        # Actor: T is 0 relative?
        # _convert_tsumo logic:
        # tag[0] is 'T'. ord('T') - ord('T') = 0. Actor = 0.
        # If actor == self.state.seat (0):
        # returns tsumo with pai.

        message = {"tag": "T132"}  # 132 is a tile index

        with patch("akagi_ng.bridge.tenhou.bridge.tenhou_to_mjai_one") as mock_conv:
            mock_conv.return_value = "5z"

            result = self.bridge._convert_tsumo(message)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "tsumo")
            self.assertEqual(result[0]["actor"], 0)
            self.assertEqual(result[0]["pai"], "5z")

    def test_convert_dahai_tsumogiri(self):
        """Test _convert_dahai (D...) Tsumogiri"""
        # D132. D is actor 0.
        # If tile index matches last drawn, tsumogiri=True.

        message = {"tag": "D132"}
        self.bridge.state.hand = [132]  # Last drawn needs to be in hand presumably?
        # Logic checks if index == self.state.hand[-1].

        with patch("akagi_ng.bridge.tenhou.bridge.tenhou_to_mjai_one") as mock_conv:
            mock_conv.return_value = "5z"

            result = self.bridge._convert_dahai(message)

            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["type"], "dahai")
            self.assertTrue(result[0]["tsumogiri"])  # D is uppercase -> normal/tsumogiri logic?
            # Code: tsumogiri = str.isupper(tag[0]) if actor != self.state.seat else index == self.state.hand[-1]
            # Since actor==seat==0, checks index matches.
            pass

    def test_convert_meld_pon(self):
        """Test _convert_meld (N) PON"""
        # who=1 (actor 1). m=encoded meld.
        # We need to mock Meld.parse_meld to return a Meld object.

        message = {"tag": "N", "who": "1", "m": "12345"}

        mock_meld = MagicMock(spec=Meld)
        mock_meld.meld_type = "pon"  # Meld.PON val? using "pon" string as bridge uses it
        mock_meld.target = 0  # target relative
        mock_meld.pai = "5z"
        mock_meld.consumed = ["5z", "5z"]

        # Bridge imports Meld. We patch it.
        with patch("akagi_ng.bridge.tenhou.bridge.Meld.parse_meld") as mock_parse:
            mock_parse.return_value = mock_meld
            # Also patch Meld constants referenced in bridge if needed?
            # Bridge uses Meld.PON, Meld.CHI etc.
            # Assuming Meld.PON is available or we use actual Meld class attributes.
            # Ideally use real Meld values if they are ints/strings.
            # Looking at code: if meld.meld_type in [Meld.KAKAN...]
            # So expected return from parse_meld should have meld_type matching Meld.PON.

            with patch("akagi_ng.bridge.tenhou.bridge.Meld") as MockMeldClass:
                # Setup constants on the mock class
                MockMeldClass.PON = "pon"
                MockMeldClass.CHI = "chi"
                MockMeldClass.ANKAN = "ankan"
                MockMeldClass.KAKAN = "kakan"
                MockMeldClass.parse_meld.return_value = mock_meld

                # We need to ensure logic uses these constants
                result = self.bridge._convert_meld(message)

                self.assertEqual(len(result), 1)
                self.assertEqual(result[0]["type"], "pon")
                self.assertEqual(result[0]["actor"], 1)

    def test_convert_reach(self):
        """Test _convert_reach"""
        message = {"tag": "REACH", "who": "1", "step": "1"}

        result = self.bridge._dispatch_reach(message)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "reach")
        self.assertEqual(result[0]["actor"], 1)
