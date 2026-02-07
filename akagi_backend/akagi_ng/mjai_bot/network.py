from collections.abc import Callable
from functools import partial

import torch
from torch import Tensor, nn

from akagi_ng.core.constants import ModelConstants


def orthogonal_init(layer: nn.Module, gain: float = 1.0) -> None:
    nn.init.orthogonal_(layer.weight, gain=gain)
    nn.init.constant_(layer.bias, 0)


def get_inference_device() -> torch.device:
    return torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")


class ChannelAttention(nn.Module):
    def __init__(self, channels: int, ratio: int = 16, actv_builder: type[nn.Module] = nn.ReLU, bias: bool = True):
        super().__init__()
        self.shared_mlp = nn.Sequential(
            nn.Linear(channels, channels // ratio, bias=bias),
            actv_builder(),
            nn.Linear(channels // ratio, channels, bias=bias),
        )
        if bias:
            for mod in self.modules():
                if isinstance(mod, nn.Linear):
                    nn.init.constant_(mod.bias, 0)

    def forward(self, x: Tensor) -> Tensor:
        avg_out = self.shared_mlp(x.mean(-1))
        max_out = self.shared_mlp(x.amax(-1))
        weight = (avg_out + max_out).sigmoid()
        return weight.unsqueeze(-1) * x


class ResBlock(nn.Module):
    def __init__(
        self,
        channels: int,
        *,
        norm_builder: type[nn.Module] = nn.Identity,
        actv_builder: type[nn.Module] = nn.ReLU,
        pre_actv: bool = False,
    ):
        super().__init__()
        self.pre_actv = pre_actv

        if pre_actv:
            self.res_unit = nn.Sequential(
                norm_builder(),
                actv_builder(),
                nn.Conv1d(channels, channels, kernel_size=3, padding=1, bias=False),
                norm_builder(),
                actv_builder(),
                nn.Conv1d(channels, channels, kernel_size=3, padding=1, bias=False),
            )
        else:
            self.res_unit = nn.Sequential(
                nn.Conv1d(channels, channels, kernel_size=3, padding=1, bias=False),
                norm_builder(),
                actv_builder(),
                nn.Conv1d(channels, channels, kernel_size=3, padding=1, bias=False),
                norm_builder(),
            )
            self.actv = actv_builder()
        self.ca = ChannelAttention(channels, actv_builder=actv_builder, bias=True)

    def forward(self, x: Tensor) -> Tensor:
        out = self.res_unit(x)
        out = self.ca(out)
        out = out + x
        if not self.pre_actv:
            out = self.actv(out)
        return out


class ResNet(nn.Module):
    def __init__(  # noqa: PLR0913
        self,
        in_channels: int,
        conv_channels: int,
        num_blocks: int,
        *,
        norm_builder: type[nn.Module] = nn.Identity,
        actv_builder: type[nn.Module] = nn.ReLU,
        pre_actv: bool = False,
    ):
        super().__init__()

        blocks = []
        for _ in range(num_blocks):
            blocks.append(
                ResBlock(
                    conv_channels,
                    norm_builder=norm_builder,
                    actv_builder=actv_builder,
                    pre_actv=pre_actv,
                )
            )

        layers = [nn.Conv1d(in_channels, conv_channels, kernel_size=3, padding=1, bias=False)]
        if pre_actv:
            layers += [*blocks, norm_builder(), actv_builder()]
        else:
            layers += [norm_builder(), actv_builder(), *blocks]
        layers += [
            nn.Conv1d(conv_channels, 32, kernel_size=3, padding=1),
            actv_builder(),
            nn.Flatten(),
            nn.Linear(32 * 34, 1024),
        ]
        self.net = nn.Sequential(*layers)

    def forward(self, x: Tensor) -> Tensor:
        return self.net(x)


class Brain(nn.Module):
    def __init__(  # noqa: PLR0913
        self,
        obs_shape_func: Callable[[int], tuple[int, ...]],
        oracle_obs_shape_func: Callable[[int], tuple[int, ...]],
        *,
        conv_channels: int,
        num_blocks: int,
        is_oracle: bool = False,
        version: int = 1,
        norm_type: str = "BN",
    ):
        super().__init__()
        self.is_oracle = is_oracle
        self.version = version

        in_channels = obs_shape_func(version)[0]
        if is_oracle:
            in_channels += oracle_obs_shape_func(version)[0]

        norm_builder = partial(nn.BatchNorm1d, conv_channels, momentum=0.01)
        actv_builder = partial(nn.Mish, inplace=True)
        pre_actv = True

        match version:
            case ModelConstants.MODEL_VERSION_1:
                actv_builder = partial(nn.ReLU, inplace=True)
                pre_actv = False
                self.latent_net = nn.Sequential(
                    nn.Linear(1024, 512),
                    nn.ReLU(inplace=True),
                )
                self.mu_head = nn.Linear(512, 512)
                self.logsig_head = nn.Linear(512, 512)
            case ModelConstants.MODEL_VERSION_2:
                pass
            case ModelConstants.MODEL_VERSION_3 | ModelConstants.MODEL_VERSION_4:
                norm_builder = partial(nn.BatchNorm1d, conv_channels, momentum=0.01, eps=1e-3)
                if norm_type == "GN":
                    norm_builder = partial(nn.GroupNorm, num_channels=conv_channels, num_groups=32, eps=1e-3)
            case _:
                raise ValueError(f"Unexpected version {self.version}")

        self.encoder = ResNet(
            in_channels=in_channels,
            conv_channels=conv_channels,
            num_blocks=num_blocks,
            norm_builder=norm_builder,
            actv_builder=actv_builder,
            pre_actv=pre_actv,
        )
        self.actv = actv_builder()

    def forward(self, obs: Tensor, invisible_obs: Tensor | None = None) -> tuple[Tensor, Tensor] | Tensor:
        if self.is_oracle:
            assert invisible_obs is not None
            obs = torch.cat((obs, invisible_obs), dim=1)
        phi = self.encoder(obs)

        match self.version:
            case ModelConstants.MODEL_VERSION_1:
                latent_out = self.latent_net(phi)
                mu = self.mu_head(latent_out)
                logsig = self.logsig_head(latent_out)
                return mu, logsig
            case ModelConstants.MODEL_VERSION_2 | ModelConstants.MODEL_VERSION_3 | ModelConstants.MODEL_VERSION_4:
                return self.actv(phi)
            case _:
                raise ValueError(f"Unexpected version {self.version}")


class AuxNet(nn.Module):
    def __init__(self, dims: list[int] | None = None):
        super().__init__()
        self.dims = dims
        self.net = nn.Linear(1024, sum(dims), bias=False)

    def forward(self, x: Tensor) -> tuple[Tensor, ...]:
        return self.net(x).split(self.dims, dim=-1)


class CategoricalPolicy(nn.Module):
    def __init__(self, action_space: int):
        super().__init__()
        self.action_space = action_space
        self.fc1 = nn.Linear(1024, 256)
        self.fc2 = nn.Linear(256, action_space)
        orthogonal_init(self.fc1)
        orthogonal_init(self.fc2)

    def forward(self, phi: Tensor, mask: Tensor) -> Tensor:
        phi = torch.tanh(self.fc1(phi))
        phi = self.fc2(phi).masked_fill(~mask, -torch.inf)
        return torch.softmax(phi, dim=-1)


class DQN(nn.Module):
    def __init__(self, action_space: int, *, version: int = 1):
        super().__init__()
        self.version = version
        self.action_space = action_space
        match version:
            case ModelConstants.MODEL_VERSION_1:
                self.v_head = nn.Linear(512, 1)
                self.a_head = nn.Linear(512, action_space)
            case ModelConstants.MODEL_VERSION_2 | ModelConstants.MODEL_VERSION_3:
                hidden_size = 512 if version == ModelConstants.MODEL_VERSION_2 else 256
                self.v_head = nn.Sequential(
                    nn.Linear(1024, hidden_size),
                    nn.Mish(inplace=True),
                    nn.Linear(hidden_size, 1),
                )
                self.a_head = nn.Sequential(
                    nn.Linear(1024, hidden_size),
                    nn.Mish(inplace=True),
                    nn.Linear(hidden_size, action_space),
                )
            case ModelConstants.MODEL_VERSION_4:
                self.net = nn.Linear(1024, 1 + action_space)
                nn.init.constant_(self.net.bias, 0)
            case _:
                raise ValueError(f"Unexpected version {self.version}")

    def forward(self, phi: Tensor, mask: Tensor) -> Tensor:
        if self.version == ModelConstants.MODEL_VERSION_4:
            v, a = self.net(phi).split((1, self.action_space), dim=-1)
        else:
            v = self.v_head(phi)
            a = self.a_head(phi)
        a_sum = a.masked_fill(~mask, 0.0).sum(-1, keepdim=True)
        mask_sum = mask.sum(-1, keepdim=True)
        a_mean = a_sum / mask_sum
        return (v + a - a_mean).masked_fill(~mask, -torch.inf)
