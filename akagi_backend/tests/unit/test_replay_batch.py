import unittest

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.replay import ReplayEngine


class MockDelegate(BaseEngine):
    def __init__(self):
        super().__init__(is_3p=False, version=1, name="mock")

    def react_batch(self, obs, masks, invisible_obs):
        return [0], [[0.0]], [[True]], [True]


class TestReplayEngine(unittest.TestCase):
    def test_react_batch_size(self):
        import numpy as np

        delegate = MockDelegate()
        replay = ReplayEngine(delegate, history_actions=[])
        replay.start_replaying()

        # Simulate a batch of 2
        batch_size = 2
        obs = np.zeros((batch_size, 93, 34))
        masks = np.zeros((batch_size, 54), dtype=bool)
        masks[0, 5] = True
        masks[1, 10] = True
        invisible_obs = np.zeros((batch_size, 93, 34))

        actions, q_out, clean_masks, is_greedy = replay.react_batch(obs, masks, invisible_obs)

        self.assertEqual(len(actions), 2, "Should return 2 actions")
        self.assertEqual(actions, [5, 10])
        self.assertEqual(len(q_out), 2, "Should return 2 q_outs")
        self.assertEqual(len(clean_masks), 2, "Should return 2 clean_masks")
        self.assertEqual(len(is_greedy), 2, "Should return 2 is_greedy flags")


if __name__ == "__main__":
    unittest.main()
