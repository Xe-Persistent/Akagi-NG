"""Engine Provider Integration Tests"""

from unittest.mock import MagicMock

import numpy as np
import pytest

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider


@pytest.fixture
def mock_engines():
    online = MagicMock(spec=BaseEngine)
    online.name = "OnlineMock"
    online.engine_type = "online"
    online.get_notification_flags.return_value = {}
    online.get_additional_meta.return_value = {"srv": "mock"}
    online.last_inference_result = {}

    local = MagicMock(spec=BaseEngine)
    local.name = "LocalMock"
    local.engine_type = "local"
    local.get_notification_flags.return_value = {}
    local.get_additional_meta.return_value = {"mdl": "v4"}
    local.last_inference_result = {}

    return online, local


def test_provider_initialization(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online, local, is_3p=False)

    assert provider.name.startswith("Provider")
    assert provider.active_engine == online
    assert provider.fallback_active is False


def test_provider_react_success(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online, local, is_3p=False)

    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)

    # Mock online success
    online.react_batch.return_value = ([0], [[1.0]], [[True]], [False])

    res = provider.react_batch(obs, masks, obs)

    assert res[0] == [0]
    assert provider.active_engine == online
    assert provider.fallback_active is False
    local.react_batch.assert_not_called()


def test_provider_react_fallback(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online, local, is_3p=False)

    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)

    # Mock online failure
    online.react_batch.side_effect = RuntimeError("Connection timeout")

    # Mock local success
    local.react_batch.return_value = ([1], [[0.9]], [[True]], [False])

    res = provider.react_batch(obs, masks, obs)

    # Should use local result
    assert res[0] == [1]
    assert provider.active_engine == local
    assert provider.fallback_active is True

    # Check flags
    flags = provider.get_notification_flags()
    assert flags.get("fallback_used") is True

    # Check meta
    meta = provider.get_additional_meta()
    assert meta["engine_type"] == "local"


def test_provider_sync_mode(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online, local, is_3p=False)

    provider.set_sync_mode(True)

    online.set_sync_mode.assert_called_with(True)
    local.set_sync_mode.assert_called_with(True)
