import unittest
from unittest.mock import MagicMock

import numpy as np
import requests

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider


class TestEngineProvider(unittest.TestCase):
    def setUp(self):
        # Mock engines
        self.mock_local_engine = MagicMock(spec=BaseEngine)
        self.mock_local_engine.react_batch.return_value = ([0], [[0.0] * 46], [[True] * 46], [True])
        self.mock_local_engine.last_inference_result = {}
        self.mock_local_engine.name = "MockLocal"
        self.mock_local_engine.engine_type = "mortal"
        self.mock_local_engine.get_additional_meta.return_value = {"local_meta": 1}
        self.mock_local_engine.get_notification_flags.return_value = {}

        self.mock_online_engine = MagicMock(spec=BaseEngine)
        self.mock_online_engine.react_batch.return_value = ([1], [[0.1] * 46], [[True] * 46], [True])
        self.mock_online_engine.last_inference_result = {}
        self.mock_online_engine.name = "MockOnline"
        self.mock_online_engine.engine_type = "akagiot"
        self.mock_online_engine.get_additional_meta.return_value = {"online_meta": 1}
        self.mock_online_engine.get_notification_flags.return_value = {}

        # Setup provider
        self.provider = EngineProvider(
            online_engine=self.mock_online_engine, local_engine=self.mock_local_engine, is_3p=False
        )
        # Ensure active_engine is set initially (though __init__ does it)
        # self.provider.active_engine = self.mock_online_engine

        self.dummy_obs = np.zeros((1, 100))
        self.dummy_masks = np.ones((1, 46), dtype=bool)

    def test_online_failure_fallback(self):
        """Test automatic fallback to local engine when online engine fails."""
        # Simulate online engine raising an exception (Circuit Trigger)
        self.mock_online_engine.react_batch.side_effect = requests.RequestException("Timeout")

        # Execute inference
        self.provider.react_batch(self.dummy_obs, self.dummy_masks, self.dummy_obs)

        # Verify fallback
        self.assertTrue(self.provider.fallback_active)
        self.assertEqual(self.provider.active_engine, self.mock_local_engine)

        # Verify local engine was called
        self.mock_local_engine.react_batch.assert_called_once()

    def test_online_recovery(self):
        """Test recovery from online engine failure."""
        # 1. Trigger failure first
        self.mock_online_engine.react_batch.side_effect = requests.RequestException("Timeout")
        self.provider.react_batch(self.dummy_obs, self.dummy_masks, self.dummy_obs)
        self.assertTrue(self.provider.fallback_active)

        # 2. Simulate recovery: Reset side_effect
        # Assuming EngineProvider retries online engine if circuit is not strictly open preventing calls
        self.mock_online_engine.react_batch.side_effect = None
        self.provider.react_batch(self.dummy_obs, self.dummy_masks, self.dummy_obs)

        # Verify fallback to online engine
        self.assertEqual(self.provider.active_engine, self.mock_online_engine)
        self.assertFalse(self.provider.fallback_active)

    def test_meta_reporting_during_fallback(self):
        """Test metadata reporting when fallback is active."""
        # Simulate fallback
        self.mock_online_engine.react_batch.side_effect = Exception("Fail")
        self.provider.react_batch(self.dummy_obs, self.dummy_masks, self.dummy_obs)

        meta = self.provider.get_additional_meta()
        flags = self.provider.get_notification_flags()

        # EngineProvider switches active_engine to local on fallback
        # BUT get_additional_meta reports primary engine type
        self.assertEqual(meta["engine_type"], "akagiot")
        # Expect fallback_used to be True
        self.assertTrue(flags.get("fallback_used"))


if __name__ == "__main__":
    unittest.main()
