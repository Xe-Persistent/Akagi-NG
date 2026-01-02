import json
import os
import sys

# Add project root
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "akagi_ng")))

try:
    from mjai_bot.bot import AkagiBot
except ImportError:
    print("Cannot import AkagiBot.")
    sys.exit(1)


# Subclass for testing to override property behavior cleanly
class MockAkagiBot(AkagiBot):
    def __init__(self, hand):
        super().__init__()
        self._mock_hand = hand

    @property
    def tehai_mjai(self):
        return self._mock_hand

    @property
    def can_ankan(self):
        return True

    @property
    def last_kawa_tile(self):
        return "1z"

    @property
    def can_daiminkan(self):
        return False


def test_complex_kan_mocked_v2():
    print("=== Testing Complex Kan Logic (Subclass Mock) ===")

    # 4m x4, 5m, 6m, 7m x4, 1p, 1s, 1z, 2z
    complex_hand = [
        "4m", "4m", "4m", "4m",
        "5m", "6m",
        "7m", "7m", "7m", "7m",
        "1p", "1s", "1z", "2z"
    ]

    bot = MockAkagiBot(complex_hand)

    print(f"Mocked Hand: {bot.tehai_mjai}")
    print(f"Mocked Can Ankan: {bot.can_ankan}")

    # Call the logic we want to test which lives on AkagiBot base class
    candidates = bot.find_ankan_candidates()
    print(f"Ankan Candidates: {json.dumps(candidates, indent=2)}")

    # Verification
    expected_consumed_4m = ["4m", "4m", "4m", "4m"]
    expected_consumed_7m = ["7m", "7m", "7m", "7m"]

    found_4m = False
    found_7m = False

    for c in candidates:
        if c['consumed'] == expected_consumed_4m: found_4m = True
        if c['consumed'] == expected_consumed_7m: found_7m = True

    if found_4m and found_7m:
        print("\n>> SUCCESS: Both 4m and 7m quads identified.")
    else:
        print(f"\n>> FAILURE: Found 4m: {found_4m}, Found 7m: {found_7m}")

    # ==========================================
    # Part 2: Payload Verification
    # ==========================================
    print("\n=== Testing Payload Generation ===")

    try:
        from core.frontend_adapter import _get_fuuro_details
    except ImportError:
        print("Importing _get_fuuro_details from core...")
        from core.frontend_adapter import _get_fuuro_details

    # We only need _get_fuuro_details for checking the Kan logic payload part specifically

    print("Simulating 'kan_select' action...")
    result = _get_fuuro_details("kan_select", bot)
    print(f"Result for kan_select: {json.dumps(result, indent=2)}")

    if result and "consumed" in result:
        consumed = result["consumed"]
        # It typically returns the first candidate found (Daiminkan -> Ankan -> Kakan).
        # Our Mock hand has Ankan.
        # But wait, priority is Daiminkan -> Ankan.
        # Does our bot have Daiminkan candidates?
        # can_daiminkan usually depends on last_kawa.
        # If we didn't mock last_kawa to match hand, find_daiminkan_candidates returns [].

        # In this mock setup, we haven't mocked last_kawa specifically or action_candidate.can_daiminkan.
        # AkagiBot default implementation checks can_daiminkan.
        # MockAkagiBot returns can_ankan=True.
        # Does it return can_daiminkan=True? No unless we add it.
        # So it falls through to Ankan.

        if consumed in [expected_consumed_4m, expected_consumed_7m]:
            print(">> SUCCESS: Payload logic correctly extracted Ankan consumed tiles.")
        else:
            print(f">> FAILURE: Payload consumed {consumed} does not match expected.")

    else:
        print(">> FAILURE: result is None or missing consumed.")


if __name__ == "__main__":
    test_complex_kan_mocked_v2()
