"""集成测试的共享 fixtures"""

import pytest

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.mjai_bot.controller import Controller
from akagi_ng.settings import Settings


@pytest.fixture
def integration_bridge():
    """创建用于集成测试的 Bridge 实例"""
    bridge = MajsoulBridge()
    yield bridge
    bridge.reset()


@pytest.fixture
def integration_controller():
    """创建用于集成测试的 Controller 实例"""
    controller = Controller()
    yield controller


@pytest.fixture
def integration_settings():
    """创建用于集成测试的默认 Settings 实例"""
    from akagi_ng.settings import get_default_settings_dict

    settings_dict = get_default_settings_dict()
    return Settings(**settings_dict)
