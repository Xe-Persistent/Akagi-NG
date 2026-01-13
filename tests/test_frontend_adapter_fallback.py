import os
import sys
import unittest
from unittest.mock import MagicMock

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

from akagi_ng.dataserver.adapter import _get_fuuro_details


class TestFrontendAdapterFallback(unittest.TestCase):
    def test_pon_fallback(self):
        """Test that pon action returns tile even if find_pon_candidates returns empty."""
        mock_bot = MagicMock()
        mock_bot.last_kawa_tile = "5p"
        # Simulate rule engine finding NO valid candidates
        mock_bot.find_pon_candidates.return_value = []

        results = _get_fuuro_details("pon", mock_bot)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tile"], "5p")
        self.assertEqual(results[0]["consumed"], [])

    def test_chi_fallback(self):
        """Test that chi action returns tile even if find_chi_candidates returns empty."""
        mock_bot = MagicMock()
        mock_bot.last_kawa_tile = "3m"
        mock_bot.find_chi_candidates.return_value = []

        # Test chi action (the actual action name used in implementation)
        results = _get_fuuro_details("chi", mock_bot)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tile"], "3m")
        self.assertEqual(results[0]["consumed"], [])


if __name__ == "__main__":
    unittest.main()
