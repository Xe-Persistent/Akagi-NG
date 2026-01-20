from functools import partial

import torch
from torch import Tensor, nn

from akagi_ng.core.constants import ModelConstants
from akagi_ng.settings import local_settings


def get_inference_device() -> torch.device:
    cfg_device = local_settings.model_config.device
    if cfg_device == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    if cfg_device == "cpu":
        return torch.device("cpu")
    if cfg_device == "auto":
        return torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
    return torch.device("cpu")


class ChannelAttention(nn.Module):
    def __init__(self, channels, ratio=16, actv_builder=nn.ReLU, bias=True):
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

    def forward(self, x: Tensor):
        avg_out = self.shared_mlp(x.mean(-1))
        max_out = self.shared_mlp(x.amax(-1))
        weight = (avg_out + max_out).sigmoid()
        return weight.unsqueeze(-1) * x


class ResBlock(nn.Module):
    def __init__(
        self,
        channels,
        *,
        norm_builder=nn.Identity,
        actv_builder=nn.ReLU,
        pre_actv=False,
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

    def forward(self, x):
        out = self.res_unit(x)
        out = self.ca(out)
        out = out + x
        if not self.pre_actv:
            out = self.actv(out)
        return out


class ResNet(nn.Module):
    def __init__(  # noqa: PLR0913
        self,
        in_channels,
        conv_channels,
        num_blocks,
        *,
        norm_builder=nn.Identity,
        actv_builder=nn.ReLU,
        pre_actv=False,
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

    def forward(self, x):
        return self.net(x)


class Brain(nn.Module):
    def __init__(self, obs_shape_func, oracle_obs_shape_func, *, conv_channels, num_blocks, is_oracle=False, version=1):  # noqa: PLR0913
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
            case 3 | 4:
                norm_builder = partial(nn.BatchNorm1d, conv_channels, momentum=0.01, eps=1e-3)
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
            case 3 | 4:
                return self.actv(phi)
            case _:
                raise ValueError(f"Unexpected version {self.version}")


class AuxNet(nn.Module):
    def __init__(self, dims=None):
        super().__init__()
        self.dims = dims
        self.net = nn.Linear(1024, sum(dims), bias=False)

    def forward(self, x):
        return self.net(x).split(self.dims, dim=-1)


class DQN(nn.Module):
    def __init__(self, action_space, *, version=1):
        super().__init__()
        self.version = version
        self.action_space = action_space
        match version:
            case 3:
                hidden_size = 256
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
            case 4:
                self.net = nn.Linear(1024, 1 + action_space)
                nn.init.constant_(self.net.bias, 0)
            case _:
                raise ValueError(f"Unexpected version {self.version}")

    def forward(self, phi, mask):
        if self.version == ModelConstants.MODEL_VERSION_4:
            v, a = self.net(phi).split((1, self.action_space), dim=-1)
        else:
            v = self.v_head(phi)
            a = self.a_head(phi)
        a_sum = a.masked_fill(~mask, 0.0).sum(-1, keepdim=True)
        mask_sum = mask.sum(-1, keepdim=True)
        a_mean = a_sum / mask_sum
        return (v + a - a_mean).masked_fill(~mask, -torch.inf)
