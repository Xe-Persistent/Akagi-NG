import json
import os
import sys

# Add cwd to path if needed
sys.path.append(os.getcwd())

try:
    from mjai.mlibriichi.state import PlayerState
except ImportError as e:
    print(f"Failed to import mjai.mlibriichi.state: {e}")
    sys.exit(1)


def test_mjai_nukidora():
    print("Testing mjai.mlibriichi.state.PlayerState with nukidora...")

    player_id = 0
    try:
        player_state = PlayerState(player_id)
    except Exception as e:
        print(f"Failed to init PlayerState: {e}")
        return

    # Valid sequence of events for a game start
    events = [
        {"type": "start_game", "id": 0},
        {"type": "start_kyoku", "bakaze": "E", "kyoku": 1, "honba": 0, "kyotaku": 0, "oya": 0, "dora_marker": "1p",
         "tehais": [["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                    ["1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s"],
                    ["2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s"], ["?"] * 13],
         "scores": [35000, 35000, 35000, 0]},
        {"type": "tsumo", "actor": 0, "pai": "N"}
    ]

    for e in events:
        try:
            player_state.update(json.dumps(e))
        except Exception as e:
            print(f"Failed at event {e['type']}: {e}")
            return

    # Now test nukidora
    nukidora_event = {"type": "nukidora", "actor": 0, "pai": "N"}

    print(f"Feeding nukidora event: {nukidora_event}")
    try:
        player_state.update(json.dumps(nukidora_event))
        print("Success: nukidora event processed by mjai.")
    except Exception as e:
        print(f"Error processing nukidora: {e}")


if __name__ == "__main__":
    test_mjai_nukidora()
