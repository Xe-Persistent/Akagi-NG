import unittest
from unittest.mock import MagicMock, patch

import numpy as np
import requests

# Adjust imports to match your project structure
# Assuming akagi_ng is in PYTHONPATH
from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine


class MockFallbackEngine(BaseEngine):
    def __init__(self):
        super().__init__(is_3p=False, version=1, name="MockFallback", is_oracle=False)
        self.call_count = 0

    def react_batch(self, obs, masks, invisible_obs):
        self.call_count += 1
        # Return fake consistent response
        batch_size = len(obs)
        actions = [0] * batch_size
        q_out = [[0.0] * 42 for _ in range(batch_size)]
        masks_out = [[False] * 42 for _ in range(batch_size)]
        is_greedy = [True] * batch_size
        return actions, q_out, masks_out, is_greedy


class TestAkagiOTCircuitBreaker(unittest.TestCase):
    def setUp(self):
        self.url = "http://fake-server"
        self.api_key = "fake-key"
        self.fallback = MockFallbackEngine()
        self.engine = AkagiOTEngine(is_3p=False, url=self.url, api_key=self.api_key, fallback_engine=self.fallback)

        # Mock some inputs
        self.obs = [np.zeros((1, 1))]  # Fake observation
        self.masks = [np.zeros((1, 1))]
        self.invisible_obs = None

    @patch("requests.Session.post")
    def test_circuit_breaker_flow(self, mock_post):
        # 1. Simulate Connection Errors
        mock_post.side_effect = requests.ConnectionError("Connection timeout")

        print("\n--- Phase 1: Failures triggering circuit breaker ---")

        # We need 3 failures to open circuit
        for i in range(3):
            print(f"Request {i + 1}...")
            self.engine.react_batch(self.obs, self.masks, self.invisible_obs)

            # Verify fallback was called
            self.assertEqual(self.fallback.call_count, i + 1)
            # Verify failure count
            self.assertEqual(self.engine.client._failures, i + 1)

        # Circuit should be open now
        self.assertTrue(self.engine.client._circuit_open, "Circuit should be open after 3 failures")
        print("Circuit is now OPEN.")

        print("\n--- Phase 2: Fast failure (Circuit Open) ---")
        # Next call should NOT call requests.post, but should still use fallback
        mock_post.reset_mock()

        self.engine.react_batch(self.obs, self.masks, self.invisible_obs)

        # Should catch RuntimeError from client.predict and use fallback
        mock_post.assert_not_called()
        self.assertEqual(self.fallback.call_count, 4)
        print("Fast fail confirmed: No network request made, fallback used.")

        print("\n--- Phase 3: Recovery Probe ---")
        # Time travel: forward 31 seconds
        original_time = self.engine.client._last_failure_time
        # Mock time.time to return original + 31
        with patch("time.time", return_value=original_time + 31):
            # Make it succeed this time
            mock_post.side_effect = None
            mock_post.return_value = MagicMock()
            mock_post.return_value.status_code = 200
            mock_post.return_value.json.return_value = {
                "actions": [0],
                "q_out": [[0.0]],
                "masks": [[False]],
                "is_greedy": [True],
            }

            print("Time elapsed. Probing...")
            self.engine.react_batch(self.obs, self.masks, self.invisible_obs)

            # Should have called post
            mock_post.assert_called()

            # Should close circuit
            self.assertFalse(self.engine.client._circuit_open, "Circuit should be closed after successful probe")
            self.assertEqual(self.engine.client._failures, 0, "Failures should be reset")
            print("Recovery successful. Circuit CLOSED.")


if __name__ == "__main__":
    unittest.main()
