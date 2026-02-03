from unittest.mock import MagicMock

import pytest

from akagi_ng.bridge import AmatsukiBridge, MajsoulBridge, RiichiCityBridge, TenhouBridge
from akagi_ng.mjai_bot.controller import Controller
from akagi_ng.settings import Settings


@pytest.fixture
def majsoul_bridge():
    """创建用于集成测试的 Majsoul Bridge 实例"""
    bridge = MajsoulBridge()
    yield bridge
    bridge.reset()


@pytest.fixture
def tenhou_bridge():
    """创建用于集成测试的 Tenhou Bridge 实例"""
    bridge = TenhouBridge()
    yield bridge
    bridge.reset()


@pytest.fixture
def riichi_city_bridge():
    """创建用于集成测试的 Riichi City Bridge 实例"""
    bridge = RiichiCityBridge()
    yield bridge
    bridge.reset()


@pytest.fixture
def amatsuki_bridge():
    """创建用于集成测试的 AmatsukiBridge 实例"""
    bridge = AmatsukiBridge()
    yield bridge
    bridge.reset()


@pytest.fixture
def integration_controller():
    """创建用于集成测试的 Controller 实例"""
    controller = Controller()
    yield controller


@pytest.fixture(autouse=True)
def mock_mortal_engine(monkeypatch):
    """
    Mock the Mortal Engine to prevent Rust extension crashes due to NumPy version mismatch
    in the integration test environment.
    """
    mock_model = MagicMock()
    # Mock return value of model.react to be a JSON string of a dummy action
    # Must be valid response expected by MortalBot
    mock_model.react.return_value = '{"type":"none", "meta":{"q_values":[0], "mask_bits":1}}'

    mock_engine = MagicMock()
    mock_engine.get_additional_meta.return_value = {"engine_type": "mortal_mock"}
    mock_engine.get_notification_flags.return_value = {}
    mock_engine.set_sync_mode = MagicMock()

    def mock_loader(player_id, is_3p):
        return mock_model, mock_engine

    monkeypatch.setattr("akagi_ng.mjai_bot.engine.factory.load_bot_and_engine", mock_loader)

    # Mock libriichi to prevent ImportError in CI environments without binary files
    mock_lib = MagicMock()
    import sys
    sys.modules["libriichi"] = mock_lib
    sys.modules["libriichi3p"] = mock_lib


@pytest.fixture
def integration_settings():
    """创建用于集成测试的默认 Settings 实例"""
    from akagi_ng.settings import get_default_settings_dict

    settings_dict = get_default_settings_dict()
    return Settings(**settings_dict)
