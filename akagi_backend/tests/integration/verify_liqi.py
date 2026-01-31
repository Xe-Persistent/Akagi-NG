import sys
from pathlib import Path

# Add backend to sys.path
backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))

try:
    from akagi_ng.bridge.majsoul.liqi import LiqiProto

    print("✅ Successfully imported LiqiProto")

    lp = LiqiProto()
    print("✅ Successfully initialized LiqiProto and built descriptors")

    # Check some common types
    types_to_check = [
        "ActionNewRound",
        "ActionDiscardTile",
        "ResCommon",
        "ActionPrototype",
        "Wrapper",
    ]
    for t in types_to_check:
        cls = lp.get_message_class(t)
        if cls:
            print(f"✅ Found message class: {t}")
        else:
            print(f"❌ FAILED to find message class: {t}")
            sys.exit(1)

    print("✨ Dynamic protocol verification successful!")

except Exception as e:
    print(f"❌ Error during verification: {e}")
    import traceback

    traceback.print_exc()
    sys.exit(1)
