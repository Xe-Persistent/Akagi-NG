import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from akagi_ng.dataserver.adapter import build_dataserver_payload


class TestFrontendAdapter(unittest.TestCase):
    def test_build_payload_no_meta(self):
        # Case 1: No meta in response
        mjai_response = {"type": "none"}
        bot = MagicMock()

        result = build_dataserver_payload(mjai_response, bot)
        self.assertIsNone(result, "Payload should be None when meta is missing")

    def test_build_payload_empty_meta(self):
        # Case 2: Empty meta in response
        mjai_response = {"type": "none", "meta": {}}
        bot = MagicMock()

        result = build_dataserver_payload(mjai_response, bot)
        self.assertIsNone(result, "Payload should be None when meta is empty")

    def test_build_payload_with_meta(self):
        # Case 3: Valid meta
        mjai_response = {
            "type": "dahai",
            "meta": {
                "q_values": [1.0, 2.0],
                "mask_bits": 3,  # binary 11 -> matches 2 q_values
            },
        }
        bot = MagicMock()
        bot.is_3p = False

        # Mocking getattr for bot properties used in adapter
        bot.last_kawa_tile = "1m"

        result = build_dataserver_payload(mjai_response, bot)
        self.assertIsNotNone(result)
        self.assertIn("recommendations", result)


if __name__ == "__main__":
    unittest.main()
