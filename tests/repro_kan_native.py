import os
import sys
from unittest.mock import MagicMock

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

from core.frontend_adapter import _get_fuuro_details


def repro_multi_kan():
    """
    Simulation of a Multi-Kan Scenario.
    Hand: (444m) 456777m 45p 44z (Dora)
    
    Situation:
    - User has a Pon of 4m (444m).
    - User draws 4m. -> Can Kakan (Added Kan) 4m.
    - User also has 777m in hand.
    - User draws 7m. -> Can Ankan (Closed Kan) 7m.
    
    Actually, to have BOTH options at the same time:
    - User must have Pon(4m) and Anko(7m) already.
    - User draws 4m.
    - Hand becomes: [4m] + [7m, 7m, 7m] + ...
    - Wait, to Ankan 7m, you need 4x7m in hand (or simple draw).
    - If you draw 4m, you can Kakan 4m.
    - But you can only Ankan 7m if you *already had* 4x7m in hand or just drew the 4th one.
    - If you drew 4m, you cannot simultaneously have just drawn the 4th 7m.
    - SO: You must have been HOLDING 4x7m in hand (without Kans) and deciding not to Kan, and NOW you draw 4m which allows Kakan.
    - OR: You have Pon(4m) active. In hand you have 3x7m. You draw... wait.
    
    Correction:
    You can only Draw one tile at a time.
    Scenario A: In hand 4x7m (hidden). Active Pon 4m. Draw 4m.
    -> Options:
       1. Ankan 7m (using the 4 in hand)
       2. Kakan 4m (using the drawn 4m + active Pon)
    This is a valid Multi-Kan scenario.
    """

    print("=== Simulating Multi-Kan Scenario ===")

    # Mock Bot
    bot = MagicMock()

    # Mock Candidates
    # 1. Ankan Candidate: 7m (Consumed: 7m, 7m, 7m, 7m)
    ankan_cand_7m = {"consumed": ["7m", "7m", "7m", "7m"]}

    # 2. Kakan Candidate: 4m (Consumed: 4m (from hand) + existing pon)
    # The 'consumed' in bot candidates usually includes the tiles being moved from hand/meld?
    # For Kakan, let's assume it returns the tiles involved. Adapter usually expects 'consumed' list.
    kakan_cand_4m = {"consumed": ["4m"]}

    # Setup Bot returns
    bot.find_daiminkan_candidates.return_value = []
    bot.find_ankan_candidates.return_value = [ankan_cand_7m]
    bot.find_kakan_candidates.return_value = [kakan_cand_4m]

    # Context
    bot.last_kawa_tile = "4m"  # Just drawn 4m
    bot.tehai_mjai = ["4m", "7m", "7m", "7m", "7m", "4p", "5p", "4z", "4z"]  # + existing Pon not in tehai list usually

    print(f"Hand State:")
    print(f"  - Active Pon: [4m, 4m, 4m]")
    print(f"  - In Hand: {bot.tehai_mjai}")
    print(f"  - Action: Drawn 4m")

    print("\n[Action] Bot recommends 'kan_select'")

    # Run Function
    results = _get_fuuro_details("kan_select", bot)

    print("\n[Result] Frontend Adapter Output (Payload Format):")

    recommendations = []
    # Simulate high confidence for kan_select
    confidence = 0.985

    if not results:
        print("  No recommendations returned!")
    else:
        # Simulate logic in _process_standard_recommendations
        for res in results:
            item = {
                "action": "kan_select",
                "confidence": confidence
            }
            item.update(res)
            recommendations.append(item)

    # Construct full payload mock
    payload = {
        "recommendations": recommendations,
        "tehai": bot.tehai_mjai,
        "is_riichi_declaration": False
    }

    import json
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    # Verify
    expected_tiles = ["7m", "4m"]  # 7m from Ankan, 4m from Kakan
    actual_tiles = [r['tile'] for r in results]

    if set(expected_tiles) == set(actual_tiles):
        print("\nSUCCESS: Both Ankan (7m) and Kakan (4m) options were identified.")
    else:
        print(f"\nFAILURE: Expected tiles {expected_tiles}, got {actual_tiles}")

if __name__ == "__main__":
    repro_multi_kan()
