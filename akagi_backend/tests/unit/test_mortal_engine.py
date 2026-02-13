from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import torch

from akagi_ng.mjai_bot.engine.mortal import MortalEngine, MortalModelResource, _sample_top_p, load_mortal_resource
from akagi_ng.mjai_bot.status import BotStatusContext


@pytest.fixture
def mock_mortal_resource():
    brain = MagicMock()
    dqn = MagicMock()
    dqn.action_space = 46

    return MortalModelResource(
        brain=brain,
        dqn=dqn,
        version=4,
        device=torch.device("cpu"),
        stochastic_latent=False,
        boltzmann_epsilon=0.0,
        boltzmann_temp=1.0,
        top_p=1.0,
        engine_name="mortal",
        enable_amp=False,
    )


def test_mortal_engine_init(mock_mortal_resource) -> None:
    engine = MortalEngine(BotStatusContext(), mock_mortal_resource, is_3p=False)
    assert engine.name == "mortal"
    assert engine.device == mock_mortal_resource.device


def test_mortal_engine_react_batch_sync(mock_mortal_resource) -> None:
    engine = MortalEngine(BotStatusContext(), mock_mortal_resource, is_3p=False)
    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)
    masks[0, 5] = True
    # is_sync 模式下跳过模型调用，直接返回第一个合法动作
    actions, _, _, is_greedy = engine.react_batch(obs, masks, obs, is_sync=True)
    assert actions == [5]
    assert is_greedy == [True]


def test_sample_top_p() -> None:
    logits = torch.tensor([[1.0, 2.0, 3.0, 4.0]])
    assert _sample_top_p(logits, 0.0).item() == 3
    res = _sample_top_p(logits, 1.0)
    assert 0 <= res.item() <= 3


def test_load_mortal_resource_success() -> None:
    model_path = Path("fake.pth")
    consts = MagicMock()
    consts.obs_shape = lambda: (200, 34)
    consts.oracle_obs_shape = lambda: (200, 34)
    consts.ACTION_SPACE = 46
    fake_state = {
        "config": {"control": {"version": 4}, "resnet": {"conv_channels": 192, "num_blocks": 40}},
        "mortal": {},
        "current_dqn": {},
    }
    with (
        patch("pathlib.Path.exists", return_value=True),
        patch("torch.load", return_value=fake_state),
        patch("akagi_ng.mjai_bot.engine.mortal.Brain") as mock_brain_class,
        patch("akagi_ng.mjai_bot.engine.mortal.DQN") as mock_dqn_class,
    ):
        mock_brain = mock_brain_class.return_value
        mock_brain.eval.return_value = mock_brain
        mock_dqn = mock_dqn_class.return_value
        mock_dqn.eval.return_value = mock_dqn
        mock_brain.load_state_dict.return_value = ([], [])
        mock_dqn.load_state_dict.return_value = ([], [])

        resource = load_mortal_resource(model_path, consts)
        assert resource is not None
        assert resource.version == 4


def test_load_mortal_resource_not_found() -> None:
    assert load_mortal_resource(Path("not_exist.pth"), MagicMock()) is None


def test_load_mortal_resource_error() -> None:
    with patch("pathlib.Path.exists", return_value=True), patch("torch.load", side_effect=RuntimeError("corrupt")):
        assert load_mortal_resource(Path("corrupt.pth"), MagicMock()) is None


def test_mortal_engine_inference_error(mock_mortal_resource) -> None:
    engine = MortalEngine(BotStatusContext(), mock_mortal_resource, is_3p=False)

    with patch.object(engine, "_react_batch", side_effect=Exception("Neural net crash")):
        obs = np.zeros((1, 200, 34))
        masks = np.ones((1, 46), dtype=bool)

        with pytest.raises(RuntimeError, match="Error during inference"):
            engine.react_batch(obs, masks, obs)


def test_mortal_engine_stochastic_boltzmann(mock_mortal_resource) -> None:
    # 设置 boltzmann
    mock_mortal_resource.boltzmann_epsilon = 1.0
    engine = MortalEngine(BotStatusContext(), mock_mortal_resource, is_3p=False)

    obs = np.zeros((1, 200, 34))
    masks = np.ones((1, 46), dtype=bool)

    with patch.object(engine, "_react_batch", return_value=([1], [[0.0] * 46], [True] * 46, [False])):
        actions, _, _, is_greedy = engine.react_batch(obs, masks, obs)
        assert len(actions) == 1
        assert is_greedy == [False]


def test_mortal_engine_react_batch_list_input(mock_mortal_resource) -> None:
    engine = MortalEngine(BotStatusContext(), mock_mortal_resource, is_3p=False)
    obs = [[[0.0] * 34] * 200]
    masks = [[True] * 46]
    actions, _, _, _ = engine.react_batch(obs, masks, obs, is_sync=True)
    assert len(actions) == 1
