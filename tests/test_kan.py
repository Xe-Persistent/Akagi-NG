import os
import sys
from unittest.mock import MagicMock

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

from core.frontend_adapter import _get_fuuro_details


def test_kan_priority():
    print("=== Testing Kan Priority Logic ===")

    # Mock Bot
    bot = MagicMock()
    bot.find_daiminkan_candidates = MagicMock(return_value=[])
    bot.find_ankan_candidates = MagicMock(return_value=[])
    bot.find_kakan_candidates = MagicMock(return_value=[])

    # Case 1: Daiminkan (Priority 1)
    print("\n[Case 1] Daiminkan")
    bot.find_daiminkan_candidates.return_value = [{"consumed": ["1m", "1m", "1m"]}]
    last_kawa = "1m"

    result = _get_fuuro_details("kan_select",
                                bot)  # Note: _get_fuuro_details logic usually relies on internal logic, pass dummy action
    # Wait, _get_fuuro_details inside adapter usually takes (action, bot)
    # Let's inspect signature again. Yes: def _get_fuuro_details(action: str, bot: Any)
    # But wait, inside adapter we access last_kawa_tile from bot?
    # No, let's double check adapter code.
    # Ah, `last_kawa = getattr(bot, "last_kawa_tile", None)` is inside the function.
    bot.last_kawa_tile = last_kawa

    result = _get_fuuro_details("kan_select", bot)
    print(f"Result: {result}")
    assert result is not None
    assert result["tile"] == "1m"
    assert result["consumed"] == ["1m", "1m", "1m"]
    print(">> Daiminkan Passed")

    # Case 2: Ankan (Priority 2)
    print("\n[Case 2] Ankan")
    bot.find_daiminkan_candidates.return_value = []
    bot.find_ankan_candidates.return_value = [{"consumed": ["2m", "2m", "2m", "2m"]}]

    result = _get_fuuro_details("kan_select", bot)
    print(f"Result: {result}")
    assert result is not None
    # Ankan tile is usually one of consumed
    assert result["tile"] == "2m"
    assert result["consumed"] == ["2m", "2m", "2m", "2m"]
    print(">> Ankan Passed")

    # Case 3: Kakan (Priority 3)
    print("\n[Case 3] Kakan")
    bot.find_ankan_candidates.return_value = []
    bot.find_kakan_candidates.return_value = [{"consumed": ["3m"]}]

    result = _get_fuuro_details("kan_select", bot)
    print(f"Result: {result}")
    assert result is not None
    assert result["tile"] == "3m"
    assert result["consumed"] == ["3m"]
    print(">> Kakan Passed")

    # Case 4: Fallback Daiminkan (Priority 1 fail, but manual inference works)
    print("\n[Case 4] Fallback Daiminkan")
    bot.find_daiminkan_candidates.return_value = []
    bot.find_ankan_candidates.return_value = []
    bot.find_kakan_candidates.return_value = []

    # Setup state for fallback
    # Bot has 3 '4m' in hand, target is '4m'
    bot.tehai_mjai = ["4m", "4m", "4m", "5p", "6p"]
    bot.last_kawa_tile = "4m"

    result = _get_fuuro_details("kan_select", bot)
    print(f"Result: {result}")
    assert result is not None
    assert result["tile"] == "4m"
    assert result["consumed"] == ["4m", "4m", "4m"]
    print(">> Fallback Daiminkan Passed")

    # Case 5: Fallback Ankan (Priority 1&2 fail, manual inference works)
    print("\n[Case 5] Fallback Ankan")
    bot.last_kawa_tile = "?"  # Ensure Daiminkan fallback doesn't trigger
    # Bot has 4 '5m' in hand
    bot.tehai_mjai = ["5m", "5m", "5m", "5m", "1p"]

    result = _get_fuuro_details("kan_select", bot)
    print(f"Result: {result}")
    assert result is not None
    assert result["tile"] == "5m"
    assert result["consumed"] == ["5m", "5m", "5m", "5m"]
    print(">> Fallback Ankan Passed")


if __name__ == "__main__":
    test_kan_priority()
