import os
import sys

import numpy as np

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.getcwd(), 'akagi_ng')))

from core.libriichi_helper import meta_to_recommend


def test_kan_recommendation():
    # Mock meta data
    # Mask index 42 is 'kan_select'
    # Create a mask where 'kan_select' and '1m' (discard) are valid
    mask_bits = (1 << 42) | (1 << 0)

    # Q-values: make kan_select (42) higher than 1m (0)
    q_values = np.zeros(46, dtype=np.float32)
    q_values[42] = 10.0
    q_values[0] = 5.0

    meta = {
        'q_values': q_values,
        'mask_bits': mask_bits,
        'is_greedy': [True],
        'eval_time_ns': 0
    }

    # Run recommendation
    recs = meta_to_recommend(meta, is_3p=False)

    print("Recommendations:")
    for action, score in recs:
        print(f"Action: {action}, Score: {score:.4f}")

    # Check if 'kan_select' is top
    if recs[0][0] == 'kan_select':
        print("\nSUCCESS: 'kan_select' is recommended.")
    else:
        print("\nFAILURE: 'kan_select' is not top.")

    # Check format
    # Expecting list of (action, score). No consumed info.
    print(f"\nTop recommendation format: {recs[0]}")
    if len(recs[0]) == 2:
        print("Confirmed: Recommendation only contains (Action, Score). No tile details.")


if __name__ == "__main__":
    test_kan_recommendation()
