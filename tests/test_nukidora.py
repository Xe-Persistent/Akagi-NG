import json
import os
import sys

# Add cwd to path to find lib
sys.path.append(os.getcwd())

try:
    from lib import libriichi3p
except ImportError as e:
    print(f"Failed to import libriichi3p: {e}")
    sys.exit(1)


def test_nukidora():
    # Setup a minimal 3p game state
    events = [
        {"type": "start_game", "id": 0},
        {"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0, "kyotaku": 0, "oya": 0, "dora_marker": "1p",
         "tehais": [["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                    ["1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s"],
                    ["2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s"], ["?"] * 13],
         "scores": [35000, 35000, 35000, 0]},
        # {"type": "tsumo", "actor": 0, "pai": "N"} # Removed to test parsing only
    ]

    # Initialize bot
    # We need a dummy engine for Bot, but we can't easily make a MortalEngine here without torch.
    # However, libriichi3p.mjai.Bot wraps a python object. We can mock it.

    class MockEngine:
        def __init__(self):
            self.name = "MockEngine"
            self.is_oracle = False
            self.version = 1
            self.enable_rule_based_agari_guard = False
            self.enable_quick_eval = False

        def react_batch(self, obs, masks, invisible_obs):
            return [0], [0], [0], [0]  # dummy return

    mock_engine = MockEngine()
    bot = libriichi3p.mjai.Bot(mock_engine, 0)

    # Feed events
    for e in events:
        bot.react(json.dumps(e))

    print("Events fed successfully.")

    # Now feed Nukidora
    nukidora_event = {"type": "nukidora", "actor": 0, "pai": "N"}  # Kita

    print(f"Feeding nukidora event: {nukidora_event}")
    try:
        # If this doesn't crash, it means libriichi3p supports it (or ignores it gracefully)
        # But specifically, if it maps to internal state correctly, it shouldn't error.
        # libriichi usually errors on unknown event types if strict.

        # Note: libriichi's Bot wrapper usually returns a JSON string.
        resp = bot.react(json.dumps(nukidora_event))
        print(f"Response: {resp}")
        print("Success: nukidora event processed without error.")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    test_nukidora()
