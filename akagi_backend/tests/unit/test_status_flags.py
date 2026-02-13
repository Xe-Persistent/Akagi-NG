from unittest.mock import MagicMock

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode


class MockEngine(BaseEngine):
    def __init__(self, status: BotStatusContext, name: str, custom_meta=None):
        super().__init__(status=status, is_3p=False, version=1, name=name, is_oracle=False)
        self.engine_type = name.lower()
        self.custom_meta = custom_meta or {}

    def fork(self, status: BotStatusContext | None = None):
        return MockEngine(status or self.status, self.name, self.custom_meta)

    def react_batch(self, obs, masks, invisible_obs=None, is_sync=None):
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, self.engine_type)
        for k, v in self.custom_meta.items():
            self.status.set_metadata(k, v)
        return [0], [[0.0]], [[True]], [True]


def test_status_flags_green_online():
    """Online Normal -> Green"""
    status = BotStatusContext()
    online = MockEngine(status, "AkagiOT")
    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, online, local, is_3p=False)

    # Normal execution
    provider.react_batch(None, None)

    meta = status.metadata
    assert meta[NotificationCode.ENGINE_TYPE] == "akagiot"
    assert meta.get(NotificationCode.FALLBACK_USED) is None
    assert meta.get(NotificationCode.RECONNECTING) is None


def test_status_flags_blue_local():
    """Local Only -> Blue"""
    status = BotStatusContext()
    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, None, local, is_3p=False)

    provider.react_batch(None, None)

    meta = status.metadata
    assert meta[NotificationCode.ENGINE_TYPE] == "mortal"
    assert meta.get(NotificationCode.FALLBACK_USED) is None
    assert meta.get(NotificationCode.RECONNECTING) is None


def test_status_flags_yellow_fallback():
    """Online Timeout/Error (Tmp) -> Yellow"""
    status = BotStatusContext()
    online = MockEngine(status, "AkagiOT")
    # Simulate react raising error
    online.react_batch = MagicMock(side_effect=RuntimeError("Timeout"))

    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, online, local, is_3p=False)

    # Trigger fallback
    # Note: local engine will set ENGINE_TYPE to 'mortal' internally,
    # but Provider should set/keep it as 'akagiot' (primary)
    provider.react_batch(None, None)

    meta = status.metadata
    # provider sets this after local.react_batch returns
    assert meta[NotificationCode.ENGINE_TYPE] == "akagiot"
    assert meta[NotificationCode.FALLBACK_USED] is True


def test_status_flags_red_circuit_breaker():
    """Online Circuit Open -> Red"""
    status = BotStatusContext()
    online = MockEngine(status, "AkagiOT")

    # Simulate react raising Circuit Open Error AND setting metadata
    def side_effect(*args, **kwargs):
        status.set_metadata(NotificationCode.RECONNECTING, True)
        raise RuntimeError("Circuit Open")

    online.react_batch = MagicMock(side_effect=side_effect)

    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, online, local, is_3p=False)

    # Trigger fallback
    provider.react_batch(None, None)

    meta = status.metadata
    assert meta[NotificationCode.ENGINE_TYPE] == "akagiot"
    assert meta[NotificationCode.FALLBACK_USED] is True
    assert meta[NotificationCode.RECONNECTING] is True
