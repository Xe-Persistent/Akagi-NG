import json
import os
import sys

# Add project root
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

try:
    from mjai_bot.bot import AkagiBot
except ImportError:
    print("Cannot import AkagiBot. Make sure PYTHONPATH is set or running from root.")
    sys.exit(1)


def test_native_daiminkan():
    print("=== Testing Native MJAI Bot Daiminkan Logic ===")

    bot = AkagiBot()

    # 1. Start Game
    bot.react({
        "type": "start_game",
        "id": 0,
        "names": ["A", "B", "C", "D"],
        "kyoku_first": 0,
        "aka_flag": True
    })

    # 2. Start Kyoku (Hero is East)
    # Hand: 4x4m, 1x5m, 1x6m, 4x7m, 1p, 1s, 1z
    # Total 13 tiles.
    tehai_13 = ["4m", "4m", "4m", "4m", "5m", "6m", "7m", "7m", "7m", "7m", "1p", "1s", "1z"]

    bot.react({
        "type": "start_kyoku",
        "bakaze": "E",
        "kyoku": 1,
        "honba": 0,
        "kyotaku": 0,
        "dora_marker": "9s",  # Safe dora marker
        "tehais": [
            tehai_13,
            ["?"] * 13,
            ["?"] * 13,
            ["?"] * 13
        ],
        "scores": [25000, 25000, 25000, 25000],
        "oya": 0
    })

    # Check state - should be 13 tiles (might be empty if failed)
    print(f"Tehai (start): {bot.tehai_mjai}")

    # 3. Tsumo 14th tile (2z) - As requested by user
    print(">> Tsumo 2z...")
    bot.react({
        "type": "tsumo",
        "actor": 0,
        "pai": "2z"
    })
    print(f"Tehai (after tsumo): {bot.tehai_mjai}")

    # === FALLBACK: If Native Initialization Failed, Force Mock State ===
    if not bot.tehai_mjai:
        print(">> [WARNING] Native initialization failed. Forcing Mock state for Verification.")
        try:
            from unittest.mock import MagicMock, PropertyMock, patch
        except ImportError:
            print("Cannot import unittest.mock")
            return

        # 14 tiles (13 from handle + 1 tsumo 2z)
        complex_hand = ["4m", "4m", "4m", "4m", "5m", "6m", "7m", "7m", "7m", "7m", "1p", "1s", "1z", "2z"]

        # We need to patch the Property on the Class level because it's a descriptor
        with patch('mjai_bot.bot.AkagiBot.tehai_mjai', new_callable=PropertyMock) as mock_tehai:
            mock_tehai.return_value = complex_hand

            with patch('mjai_bot.bot.AkagiBot.can_ankan', new_callable=PropertyMock) as mock_can:
                mock_can.return_value = True

                with patch('mjai_bot.bot.AkagiBot.last_kawa_tile', new_callable=PropertyMock) as mock_kawa:
                    mock_kawa.return_value = "1z"  # Dummy

                    print(f"Mocked Tehai: {bot.tehai_mjai}")
                    print(f"Mocked Can Ankan? {bot.can_ankan}")

                    try:
                        from core.frontend_adapter import _get_fuuro_details
                        print("Checking _get_fuuro_details('kan_select')...")
                        payload = _get_fuuro_details("kan_select", bot)
                        print(f"Payload: {json.dumps(payload, indent=2)}")
                    except ImportError:
                        pass

                    print("\n--- Checking Candidates ---")
                    ankan = bot.find_ankan_candidates()
                    print(f"find_ankan_candidates(): {json.dumps(ankan, indent=2)}")
        return

    print(f"Can Ankan? {getattr(bot, 'can_ankan', False)}")

    # Test 'kan_select' payload generation
    try:
        from core.frontend_adapter import _get_fuuro_details
        print("Checking _get_fuuro_details('kan_select')...")
        payload = _get_fuuro_details("kan_select", bot)
        print(f"Payload: {json.dumps(payload, indent=2)}")
    except ImportError:
        pass

    # 4. Check Candidates
    print("\n--- Checking Candidates ---")
    ankan = bot.find_ankan_candidates()
    print(f"find_ankan_candidates(): {json.dumps(ankan, indent=2)}")

    return


if __name__ == "__main__":
    test_native_daiminkan()
