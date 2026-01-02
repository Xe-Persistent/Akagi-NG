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
    bot.last_kawa_tile = last_kawa

    results = _get_fuuro_details("kan_select", bot)
    print(f"Result: {results}")
    assert isinstance(results, list)
    assert len(results) == 1
    assert results[0]["tile"] == "1m"
    assert results[0]["consumed"] == ["1m", "1m", "1m"]
    print(">> Daiminkan Passed")

    # Case 2: Ankan (Priority 2)
    print("\n[Case 2] Ankan")
    bot.find_daiminkan_candidates.return_value = []
    bot.find_ankan_candidates.return_value = [{"consumed": ["2m", "2m", "2m", "2m"]}]
    bot.find_kakan_candidates.return_value = []

    results = _get_fuuro_details("kan_select", bot)
    print(f"Result: {results}")
    assert isinstance(results, list)
    assert len(results) == 1
    assert results[0]["tile"] == "2m"
    assert results[0]["consumed"] == ["2m", "2m", "2m", "2m"]
    print(">> Ankan Passed")

    # Case 3: Kakan (Priority 3)
    print("\n[Case 3] Kakan")
    bot.find_ankan_candidates.return_value = []
    bot.find_kakan_candidates.return_value = [{"consumed": ["3m"]}]

    results = _get_fuuro_details("kan_select", bot)
    print(f"Result: {results}")
    assert isinstance(results, list)
    assert len(results) == 1
    assert results[0]["tile"] == "3m"
    assert results[0]["consumed"] == ["3m"]
    print(">> Kakan Passed")

    # Case 4: Multiple Ankan (Multi-Kan)
    print("\n[Case 4] Multiple Ankan")
    bot.find_ankan_candidates.return_value = [
        {"consumed": ["4m", "4m", "4m", "4m"]},
        {"consumed": ["5p", "5p", "5p", "5p"]}
    ]
    bot.find_kakan_candidates.return_value = []

    results = _get_fuuro_details("kan_select", bot)
    print(f"Result: {results}")
    assert isinstance(results, list)
    assert len(results) == 2

    # Sort or check existence
    tiles = sorted([r["tile"] for r in results])
    assert tiles == ["4m", "5p"]
    print(">> Multiple Ankan Passed")

    # Case 5: Ankan + Kakan (Mixed Multi-Kan)
    print("\n[Case 5] Ankan + Kakan")
    bot.find_ankan_candidates.return_value = [{"consumed": ["6s", "6s", "6s", "6s"]}]
    bot.find_kakan_candidates.return_value = [{"consumed": ["7z"]}]

    results = _get_fuuro_details("kan_select", bot)
    print(f"Result: {results}")
    assert isinstance(results, list)
    assert len(results) == 2

    tiles = sorted([r["tile"] for r in results])
    assert tiles == ["6s", "7z"]
    print(">> Ankan + Kakan Passed")


if __name__ == "__main__":
    test_kan_priority()
