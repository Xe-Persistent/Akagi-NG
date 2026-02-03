import pytest
import torch

from akagi_ng.mjai_bot.network import DQN, AuxNet, Brain, ChannelAttention, ResBlock, ResNet, get_inference_device


def test_inference_device_detection():
    # Test with default settings (auto)
    device = get_inference_device()
    assert isinstance(device, torch.device)


def test_channel_attention():
    channels = 64
    ca = ChannelAttention(channels=channels, ratio=16)
    x = torch.randn(1, channels, 34)
    out = ca(x)
    assert out.shape == x.shape
    # Check if weights were applied (not identical, but same shape)
    assert not torch.equal(x, out)


def test_res_block_standard():
    channels = 64
    block = ResBlock(channels=channels, pre_actv=False)
    x = torch.randn(1, channels, 34)
    out = block(x)
    assert out.shape == x.shape


def test_res_block_pre_actv():
    channels = 64
    block = ResBlock(channels=channels, pre_actv=True)
    x = torch.randn(1, channels, 34)
    out = block(x)
    assert out.shape == x.shape


def test_resnet_v3_structure():
    in_channels = 200
    conv_channels = 128
    num_blocks = 2
    net = ResNet(in_channels=in_channels, conv_channels=conv_channels, num_blocks=num_blocks, pre_actv=True)
    x = torch.randn(1, in_channels, 34)
    out = net(x)
    # 1st conv (34) -> ResBlocks -> conv(32*34) -> Flatten -> Linear(1024)
    assert out.shape == (1, 1024)


def test_brain_v4():
    def obs_shape(v):
        return (192, 34)

    def oracle_shape(v):
        return (45, 34)

    brain = Brain(
        obs_shape_func=obs_shape,
        oracle_obs_shape_func=oracle_shape,
        conv_channels=128,
        num_blocks=2,
        is_oracle=False,
        version=4,
    )
    x = torch.randn(1, 192, 34)
    out = brain(x)
    assert out.shape == (1, 1024)


def test_brain_v4_oracle():
    def obs_shape(v):
        return (192, 34)

    def oracle_shape(v):
        return (45, 34)

    brain = Brain(
        obs_shape_func=obs_shape,
        oracle_obs_shape_func=oracle_shape,
        conv_channels=128,
        num_blocks=2,
        is_oracle=True,
        version=4,
    )
    obs = torch.randn(1, 192, 34)
    invisible = torch.randn(1, 45, 34)
    out = brain(obs, invisible)
    assert out.shape == (1, 1024)


def test_aux_net():
    dims = [10, 20, 30]
    aux = AuxNet(dims=dims)
    x = torch.randn(1, 1024)
    outs = aux(x)
    assert len(outs) == 3
    assert outs[0].shape == (1, 10)
    assert outs[1].shape == (1, 20)
    assert outs[2].shape == (1, 30)


def test_dqn_v3():
    action_space = 46
    dqn = DQN(action_space=action_space, version=3)
    phi = torch.randn(1, 1024)
    mask = torch.ones(1, action_space, dtype=torch.bool)
    out = dqn(phi, mask)
    assert out.shape == (1, action_space)


def test_dqn_v4():
    action_space = 46
    dqn = DQN(action_space=action_space, version=4)
    phi = torch.randn(1, 1024)
    mask = torch.ones(1, action_space, dtype=torch.bool)
    out = dqn(phi, mask)
    assert out.shape == (1, action_space)


def test_dqn_with_masking():
    action_space = 4
    dqn = DQN(action_space=action_space, version=4)
    phi = torch.randn(1, 1024)
    mask = torch.tensor([[True, True, False, False]])
    out = dqn(phi, mask)
    # Masked values should be -inf
    assert torch.isinf(out[0, 2]) and out[0, 2] < 0
    assert torch.isinf(out[0, 3]) and out[0, 3] < 0
    assert not torch.isinf(out[0, 0])
    assert not torch.isinf(out[0, 1])


def test_invalid_brain_version():
    with pytest.raises(ValueError, match="Unexpected version"):
        Brain(lambda x: (1, 1), lambda x: (1, 1), conv_channels=64, num_blocks=1, version=999)
