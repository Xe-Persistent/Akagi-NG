"""Engine Provider Integration Tests"""

from unittest.mock import MagicMock

import numpy as np
import pytest

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.notifications import NotificationCode


@pytest.fixture
def mock_engines():
    online_status = BotStatusContext()
    online = MagicMock(spec=BaseEngine)
    online.name = "OnlineMock"
    online.engine_type = "akagiot"
    online.status = online_status
    online.version = 1

    local_status = BotStatusContext()
    local = MagicMock(spec=BaseEngine)
    local.name = "LocalMock"
    local.engine_type = "mortal"
    local.status = local_status
    local.version = 1

    return online, local


def test_provider_initialization(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online.status, online, local, is_3p=False)

    assert provider.name.startswith("Provider")
    assert provider.active_engine == online
    assert provider.fallback_active is False


def test_provider_react_success(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online.status, online, local, is_3p=False)

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
    provider = EngineProvider(online.status, online, local, is_3p=False)

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
    flags = provider.status.flags
    assert flags.get(str(NotificationCode.FALLBACK_USED)) is True

    # Check meta
    meta = provider.status.metadata
    assert meta["engine_type"] == "akagiot"


def test_provider_options_passing(mock_engines):
    online, local = mock_engines
    provider = EngineProvider(online.status, online, local, is_3p=False)

    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)

    # Mock online success
    online.react_batch.return_value = ([0], [[1.0]], [[True]], [False])

    provider.react_batch(obs, masks, obs, is_sync=True)

    online.react_batch.assert_called_with(obs, masks, obs, is_sync=True)
