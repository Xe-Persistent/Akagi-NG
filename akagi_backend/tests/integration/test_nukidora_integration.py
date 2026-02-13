import json

import pytest

# Try to import libriichi3p, skip test if not available
try:
    from akagi_ng.core.lib_loader import libriichi3p
except ImportError:
    pytest.skip("libriichi3p not available", allow_module_level=True)


@pytest.fixture
def mock_engine():
    """Mock engine that satisfies libriichi3p.mjai.Bot requirement."""

    class Engine:
        def __init__(self):
            self.name = "MockEngine"
            self.is_oracle = False
            self.version = 1
            self.enable_rule_based_agari_guard = True
            self.enable_quick_eval = True

        def react_batch(self, obs, masks, invisible_obs):
            return [0], [0], [0], [0]

    return Engine()


@pytest.fixture
def bot_3p(mock_engine):
    """Initialize a 3-player bot."""
    return libriichi3p.mjai.Bot(mock_engine, 0)


def test_nukidora_event_processing(bot_3p):
    """Verify that a nukidora (Kita) event is processed without error by libriichi3p."""
    # 1. Setup minimal 3P game state
    events = [
        {"type": "start_game", "id": 0, "is_3p": True},
        {
            "type": "start_kyoku",
            "bakaze": "E",
            "kyoku": 1,
            "honba": 0,
            "kyotaku": 0,
            "oya": 0,
            "dora_marker": "1p",
            "tehais": [
                ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p"],
                ["1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s", "1s"],
                ["2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s", "2s"],
                ["?"] * 13,
            ],
            "scores": [35000, 35000, 35000, 0],
        },
    ]

    for e in events:
        bot_3p.react(json.dumps(e))

    # 2. Feed Nukidora event
    nukidora_event = {"type": "nukidora", "actor": 0, "pai": "N"}  # Kita

    # If this doesn't raise an exception, it means the underlying Rust core
    # handles the nukidora type correctly in 3P mode.
    resp_json = bot_3p.react(json.dumps(nukidora_event))

    if resp_json:
        resp = json.loads(resp_json)
        # The response should be a valid MJAI action
        assert isinstance(resp, dict)
        assert "type" in resp
    else:
        # None result is acceptable if no immediate MJAI action is required
        pass
