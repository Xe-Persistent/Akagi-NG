import os
import sys

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

from akagi_ng.mjai_bot.bot import AkagiBot


def test_last_kawa_tile():
    bot = AkagiBot()

    # 1. Start Game
    bot.react({
        "type": "start_game",
        "id": 0,
        "names": ["A", "B", "C", "D"],
        "kyoku_first": 0,
        "aka_flag": True
    })

    # 2. Start Kyoku
    bot.react({
        "type": "start_kyoku",
        "bakaze": "E",
        "kyoku": 1,
        "honba": 0,
        "kyotaku": 0,
        "dora_marker": "1m",
        "tehais": [
            ["1m", "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p"],
            ["?"] * 13,
            ["?"] * 13,
            ["?"] * 13
        ],
        "scores": [25000, 25000, 25000, 25000]
    })

    # 3. Opponent (Player 1) discards '5p'
    bot.react({
        "type": "dahai",
        "actor": 1,
        "pai": "5p",
        "tsumogiri": False
    })

    print(f"Last Kawa Tile after opponent dahai: {getattr(bot, 'last_kawa_tile', 'MISSING')}")

    # Check if last_kawa_tile is '5p'
    if getattr(bot, 'last_kawa_tile', None) == '5p':
        print("SUCCESS: last_kawa_tile is correctly updated.")
    else:
        print("FAILURE: last_kawa_tile is NOT updated or incorrect.")


if __name__ == "__main__":
    test_last_kawa_tile()
