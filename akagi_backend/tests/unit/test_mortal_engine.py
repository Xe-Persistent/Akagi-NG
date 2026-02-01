from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import torch

from akagi_ng.mjai_bot.engine.mortal import MortalEngine, _sample_top_p, load_local_mortal_engine


@pytest.fixture
def mock_mortal_components():
    brain = MagicMock()
    dqn = MagicMock()
    dqn.action_space = 46
    brain.encoder = MagicMock()
    brain.encoder.net = [MagicMock()]
    brain.encoder.net[0].in_channels = 200
    return brain, dqn


def test_mortal_engine_warmup(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4, name="test")
    with patch.object(engine, "react_batch") as mock_react:
        engine.warmup()
        assert mock_react.called


def test_mortal_engine_react_batch_sync(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4)
    engine.set_sync_mode(True)
    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)
    masks[0, 5] = True
    actions, q_out, clean_masks, is_greedy = engine.react_batch(obs, masks, obs)
    assert actions == [5]
    assert is_greedy == [True]


def test_sample_top_p() -> None:
    logits = torch.tensor([[1.0, 2.0, 3.0, 4.0]])
    assert _sample_top_p(logits, 0.0).item() == 3
    res = _sample_top_p(logits, 1.0)
    assert 0 <= res.item() <= 3


def test_load_local_mortal_engine_success() -> None:
    model_path = Path("fake.pth")
    consts = MagicMock()
    consts.obs_shape = lambda: (200, 34)
    consts.ACTION_SPACE = 46
    fake_state = {
        "config": {"control": {"version": 4}, "resnet": {"conv_channels": 192, "num_blocks": 40}},
        "mortal": {},
        "current_dqn": {},
    }
    with (
        patch("pathlib.Path.exists", return_value=True),
        patch("torch.load", return_value=fake_state),
        # Patch models used inside load_local_mortal_engine
        patch("akagi_ng.mjai_bot.engine.mortal.Brain"),
        patch("akagi_ng.mjai_bot.engine.mortal.DQN"),
        patch("akagi_ng.mjai_bot.engine.mortal.MortalEngine.warmup"),
    ):
        engine = load_local_mortal_engine(model_path, consts)
        assert engine is not None
        assert engine.version == 4


def test_load_local_mortal_engine_not_found() -> None:
    assert load_local_mortal_engine(Path("not_exist.pth"), MagicMock()) is None


def test_load_local_mortal_engine_error() -> None:
    with patch("pathlib.Path.exists", return_value=True), patch("torch.load", side_effect=RuntimeError("corrupt")):
        assert load_local_mortal_engine(Path("corrupt.pth"), MagicMock()) is None
