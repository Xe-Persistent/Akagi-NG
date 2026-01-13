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
        delegate = MockDelegate()
        replay = ReplayEngine(delegate, history_actions=[])

        # Simulate a batch of 2
        # Obs and Invisible Obs shapes don't matter much for ReplayEngine as it ignores them in replay mode
        obs = [None, None]
        masks = [[True, False], [False, True]]
        invisible_obs = [None, None]

        actions, q_out, clean_masks, is_greedy = replay.react_batch(obs, masks, invisible_obs)

        self.assertEqual(len(actions), 2, "Should return 2 actions")
        self.assertEqual(len(q_out), 2, "Should return 2 q_outs")
        self.assertEqual(len(clean_masks), 2, "Should return 2 clean_masks")
        self.assertEqual(len(is_greedy), 2, "Should return 2 is_greedy flags")


if __name__ == "__main__":
    unittest.main()
