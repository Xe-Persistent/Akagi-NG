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

    brain.return_value = torch.zeros((1, 1024))
    dqn.return_value = torch.zeros((1, 46))

    brain.to.return_value = brain
    brain.eval.return_value = brain
    dqn.to.return_value = dqn
    dqn.eval.return_value = dqn

    return brain, dqn


def test_mortal_engine_warmup(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4, name="test")
    with patch.object(engine, "react_batch") as mock_react:
        engine.warmup()
        assert mock_react.called
        args, _ = mock_react.call_args
        assert len(args) == 3
        assert args[2] is not None
        assert args[2].shape == (1, 200, 34)


def test_mortal_engine_react_batch_sync(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4)
    engine.set_sync_mode(True)
    obs = np.zeros((1, 200, 34))
    masks = np.zeros((1, 46), dtype=bool)
    masks[0, 5] = True
    actions, _, _, is_greedy = engine.react_batch(obs, masks, obs)
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
        patch("akagi_ng.mjai_bot.engine.mortal.Brain") as mock_brain_class,
        patch("akagi_ng.mjai_bot.engine.mortal.DQN") as mock_dqn_class,
        patch("akagi_ng.mjai_bot.engine.mortal.MortalEngine.warmup"),
    ):
        mock_brain = mock_brain_class.return_value
        mock_brain.eval.return_value = mock_brain
        mock_dqn = mock_dqn_class.return_value
        mock_dqn.eval.return_value = mock_dqn
        mock_brain.load_state_dict.return_value = ([], [])
        mock_dqn.load_state_dict.return_value = ([], [])
        engine = load_local_mortal_engine(model_path, consts)
        assert engine is not None
        assert engine.version == 4


def test_load_local_mortal_engine_not_found() -> None:
    assert load_local_mortal_engine(Path("not_exist.pth"), MagicMock()) is None


def test_load_local_mortal_engine_error() -> None:
    with patch("pathlib.Path.exists", return_value=True), patch("torch.load", side_effect=RuntimeError("corrupt")):
        assert load_local_mortal_engine(Path("corrupt.pth"), MagicMock()) is None


def test_mortal_engine_inference_error(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4)

    # We must patch the method that does the actual work to raise exception
    with patch.object(engine, "_react_batch", side_effect=Exception("Neural net crash")):
        obs = np.zeros((1, 200, 34))
        masks = np.ones((1, 46), dtype=bool)

        with pytest.raises(RuntimeError, match="Error during inference"):
            engine.react_batch(obs, masks, obs)


def test_mortal_engine_stochastic_boltzmann(mock_mortal_components) -> None:
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4, boltzmann_epsilon=1.0, boltzmann_temp=1.0, top_p=0.9)

    obs = np.zeros((1, 200, 34))
    masks = np.ones((1, 46), dtype=bool)

    # Mock return value for _react_batch
    with patch.object(engine, "_react_batch", return_value=([1], [[0.0] * 46], [True] * 46, [False])):
        actions, _, _, is_greedy = engine.react_batch(obs, masks, obs)
        assert len(actions) == 1
        assert is_greedy == [False]


def test_mortal_engine_warmup_error(mock_mortal_components) -> None:
    """验证 warmup 中的异常被捕获且不中断流程"""
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4, name="test")
    # 让 brain.encoder 访问抛出异常
    del brain.encoder
    # 应该被捕获并打印 warning，不抛出异常
    engine.warmup()


def test_mortal_engine_react_batch_unsupported_version(mock_mortal_components) -> None:
    """验证不支持的版号会抛出 ValueError (并被包装在 RuntimeError)"""
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=99)
    obs = np.zeros((1, 200, 34))
    masks = np.ones((1, 46), dtype=bool)
    with pytest.raises(RuntimeError, match="Unsupported Mortal version"):
        engine.react_batch(obs, masks, obs)


def test_sample_top_p_complex() -> None:
    """测试 _sample_top_p 的累积分布过滤逻辑"""
    # 构造确定性的 logits: [high, medium, low]
    # softmax 之后 high + medium 将超过 0.5
    logits = torch.tensor([[10.0, 5.0, 1.0, 1.0]])

    # p=0.0 -> Argmax (index 0)
    assert _sample_top_p(logits, 0.0).item() == 0

    # p=0.5 -> 只有 index 0 参与采样 (因为 index 0 本身 prob 就接近 1.0 了)
    # 这里我们构造一个更平缓的分布来测试 cumsum 过滤
    logits_flat = torch.tensor([[0.4, 0.3, 0.2, 0.1]]).log()
    # softmax(log(x)) = x
    # p=0.45 -> idx 0 (0.4) <= 0.45? Sort: 0.4, 0.3, 0.2, 0.1.
    # Cumsum: 0.4, 0.7, 0.9, 1.0
    # Mask = cumsum - probs > p:
    # 0.4-0.4=0 > 0.45 (F)
    # 0.7-0.3=0.4 > 0.45 (F)
    # 0.9-0.2=0.7 > 0.45 (T) -> index 2 and 3 masked to 0

    # 我们只需验证返回的索引在 0 或 1 之间
    res = _sample_top_p(logits_flat, 0.45)
    assert res.item() in [0, 1]


def test_load_local_mortal_engine_corrupt_config() -> None:
    """测试配置文件格式错误的情况"""
    model_path = Path("fake.pth")
    # 缺少 config 键
    fake_state = {"mortal": {}}
    with (
        patch("pathlib.Path.exists", return_value=True),
        patch("torch.load", return_value=fake_state),
    ):
        assert load_local_mortal_engine(model_path, MagicMock()) is None


def test_mortal_engine_stochastic_boltzmann_real_logic(mock_mortal_components) -> None:
    """测试 boltzmann_epsilon > 0 的真实内部分支逻辑"""
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4, boltzmann_epsilon=0.5, boltzmann_temp=1.0)

    # 因为 engine 内部调用了 .to().eval()，这些返回的也是 MagicMock
    # 我们需要设置最终执行时的返回值
    engine.brain.return_value = torch.zeros((1, 1024))
    engine.dqn.return_value = torch.ones((1, 46))

    obs = np.zeros((1, 200, 34))
    masks = np.ones((1, 46), dtype=bool)

    actions, _, _, is_greedy = engine.react_batch(obs, masks, obs)
    assert len(actions) == 1
    # is_greedy 应该是 bool 列表
    assert isinstance(is_greedy[0], bool)


def test_mortal_engine_warmup_warning_log(mock_mortal_components) -> None:
    """触发 warmup 中的 warning log 覆盖"""
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4)
    # 模拟 react_batch 抛出异常
    with (
        patch.object(engine, "react_batch", side_effect=Exception("Warmup crash")),
        patch("akagi_ng.mjai_bot.engine.mortal.logger.warning") as mock_warn,
    ):
        engine.warmup()
        mock_warn.assert_called_with("MortalEngine warmup failed: Warmup crash")


def test_mortal_engine_react_batch_list_input(mock_mortal_components) -> None:
    """验证输入可以接受列表（虽然类型提示建议 np.ndarray，但代码用了 np.asanyarray）"""
    brain, dqn = mock_mortal_components
    engine = MortalEngine(brain, dqn, version=4)
    engine.set_sync_mode(True)
    obs = [[[0.0] * 34] * 200]
    masks = [[True] * 46]
    actions, _, _, _ = engine.react_batch(obs, masks, obs)
    assert len(actions) == 1
