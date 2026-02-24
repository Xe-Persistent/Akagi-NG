from unittest.mock import MagicMock

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.status import BotStatusContext


class MockEngine(BaseEngine):
    def __init__(self, status: BotStatusContext, name: str, custom_meta=None):
        super().__init__(status=status, is_3p=False, version=1, name=name, is_oracle=False)
        self.engine_type = name.lower()
        self.custom_meta = custom_meta or {}

    def fork(self, status: BotStatusContext | None = None):
        return MockEngine(status or self.status, self.name, self.custom_meta)

    def react_batch(self, obs, masks, invisible_obs=None, is_sync=None):
        self.status.set_metadata("engine_type", self.engine_type)
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
    assert meta["engine_type"] == "akagiot"
    assert meta.get("fallback_used") is False
    assert meta.get("online_service_reconnecting") is None


def test_status_flags_blue_local():
    """Local Only -> Blue"""
    status = BotStatusContext()
    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, None, local, is_3p=False)

    provider.react_batch(None, None)

    meta = status.metadata
    assert meta["engine_type"] == "mortal"
    assert meta.get("fallback_used") is False
    assert meta.get("online_service_reconnecting") is None


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
    assert meta["engine_type"] == "akagiot"
    assert meta["fallback_used"] is True


def test_status_flags_red_circuit_breaker():
    """Online Circuit Open -> Red"""
    status = BotStatusContext()
    online = MockEngine(status, "AkagiOT")

    # Simulate react raising Circuit Open Error AND setting metadata
    def side_effect(*args, **kwargs):
        status.set_metadata("online_service_reconnecting", True)
        raise RuntimeError("Circuit Open")

    online.react_batch = MagicMock(side_effect=side_effect)

    local = MockEngine(status, "Mortal")
    provider = EngineProvider(status, online, local, is_3p=False)

    # Trigger fallback
    provider.react_batch(None, None)

    meta = status.metadata
    assert meta["engine_type"] == "akagiot"
    assert meta["fallback_used"] is True
    assert meta["online_service_reconnecting"] is True
