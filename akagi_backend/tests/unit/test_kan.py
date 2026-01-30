from unittest.mock import MagicMock, patch

from akagi_ng.dataserver.adapter import _get_fuuro_details, _process_standard_recommendations


class TestKanLogic:
    def test_kan_priority(self):
        """Test that _get_fuuro_details correctly prioritizes Daiminkan > Ankan > Kakan"""
        # Mock Bot
        bot = MagicMock()
        bot.find_daiminkan_candidates.return_value = []
        bot.find_ankan_candidates.return_value = []
        bot.find_kakan_candidates.return_value = []

        # Case 1: Daiminkan (Priority 1)
        bot.find_daiminkan_candidates.return_value = [{"consumed": ["1m", "1m", "1m"]}]
        last_kawa = "1m"
        bot.last_kawa_tile = last_kawa

        results = _get_fuuro_details("kan", bot)
        assert len(results) == 1
        assert results[0]["tile"] == "1m"
        assert results[0]["consumed"] == ["1m", "1m", "1m"]

        # Case 2: Ankan (Priority 2)
        bot.find_daiminkan_candidates.return_value = []
        bot.find_ankan_candidates.return_value = [{"consumed": ["2m", "2m", "2m", "2m"]}]

        results = _get_fuuro_details("kan", bot)
        assert len(results) == 1
        assert results[0]["tile"] == "2m"
        assert results[0]["consumed"] == ["2m", "2m", "2m", "2m"]

        # Case 3: Kakan (Priority 3)
        bot.find_ankan_candidates.return_value = []
        bot.find_kakan_candidates.return_value = [{"consumed": ["3m"]}]

        results = _get_fuuro_details("kan", bot)
        assert len(results) == 1
        assert results[0]["tile"] == "3m"
        assert results[0]["consumed"] == ["3m"]

    def test_kan_select_renaming(self):
        """Test that 'kan_select' is correctly renamed to 'kan' in recommendations"""
        bot = MagicMock()

        # Mock meta_to_recommend to return 'kan_select'
        with patch("akagi_ng.dataserver.adapter.meta_to_recommend") as mock_recommend:
            mock_recommend.return_value = [("kan_select", 0.9)]

            # Mock _get_fuuro_details to avoid complex bot setup, just return dummy details
            with patch("akagi_ng.dataserver.adapter._get_fuuro_details") as mock_details:
                mock_details.return_value = [{"tile": "1m", "consumed": ["1m"]}]

                meta = {"q_values": [], "mask_bits": []}  # Dummy meta

                recommendations = _process_standard_recommendations(meta, bot)

                # Verify renaming happened
                assert len(recommendations) == 1
                assert recommendations[0]["action"] == "kan"

                # Verify _get_fuuro_details was called with "kan", NOT "kan_select"
                mock_details.assert_called_with("kan", bot)

    def test_kan_multi_candidates(self):
        """Test behavior when multiple Kan candidates exist (e.g. multiple Ankans)"""
        bot = MagicMock()
        bot.find_daiminkan_candidates.return_value = []
        bot.find_kakan_candidates.return_value = []

        bot.find_ankan_candidates.return_value = [
            {"consumed": ["4m", "4m", "4m", "4m"]},
            {"consumed": ["5p", "5p", "5p", "5p"]},
        ]

        results = _get_fuuro_details("kan", bot)
        assert len(results) == 2

        tiles = sorted([r["tile"] for r in results])
        assert tiles == ["4m", "5p"]
