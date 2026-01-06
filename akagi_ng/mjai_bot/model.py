import gzip
import json
from functools import partial

import numpy as np
import requests
import torch
from torch import Tensor, nn
from torch.distributions import Categorical

from akagi_ng.mjai_bot.logger import logger
from akagi_ng.settings import local_settings

OT_REQUEST_TIMEOUT = 2


def get_inference_device() -> torch.device:
    cfg_device = local_settings.model_config.device
    if cfg_device == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    elif cfg_device == "cpu":
        return torch.device("cpu")
    elif cfg_device == "auto":
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
        x = weight.unsqueeze(-1) * x
        return x


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
    def __init__(
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
    def __init__(self, obs_shape_func, oracle_obs_shape_func, *, conv_channels, num_blocks, is_oracle=False, version=1):
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
        if self.version == 4:
            v, a = self.net(phi).split((1, self.action_space), dim=-1)
        else:
            v = self.v_head(phi)
            a = self.a_head(phi)
        a_sum = a.masked_fill(~mask, 0.0).sum(-1, keepdim=True)
        mask_sum = mask.sum(-1, keepdim=True)
        a_mean = a_sum / mask_sum
        q = (v + a - a_mean).masked_fill(~mask, -torch.inf)
        return q


class MortalEngine:
    def __init__(
            self,
            brain,
            dqn,
            is_oracle,
            version,
            device=None,
            stochastic_latent=False,
            name="NoName",
            boltzmann_epsilon=0,
            boltzmann_temp=1,
            top_p=1,
            is_3p=False,
    ):
        self.engine_type = "mortal"
        self.device = device or get_inference_device()
        assert isinstance(self.device, torch.device)
        self.brain = brain.to(self.device).eval()
        self.dqn = dqn.to(self.device).eval()
        self.is_oracle = is_oracle
        self.version = version
        self.stochastic_latent = stochastic_latent

        self.name = name

        self.boltzmann_epsilon = boltzmann_epsilon
        self.boltzmann_temp = boltzmann_temp
        self.top_p = top_p
        self.is_3p = is_3p

        self.last_inference_result = None
        self.is_online = False

    @property
    def enable_amp(self) -> bool:
        return local_settings.model_config.enable_amp

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return local_settings.model_config.rule_based_agari_guard

    @property
    def enable_quick_eval(self) -> bool:
        return local_settings.model_config.enable_quick_eval

    def react_batch(self, obs, masks, invisible_obs):
        # Access global settings
        ot_server_config = local_settings.model_config.ot

        if ot_server_config.online:
            try:
                list_obs = [o.tolist() for o in obs]
                list_masks = [m.tolist() for m in masks]
                post_data = {
                    "obs": list_obs,
                    "masks": list_masks,
                }
                data = json.dumps(post_data, separators=(",", ":"))
                compressed_data = gzip.compress(data.encode("utf-8"))
                headers = {
                    "Authorization": ot_server_config.api_key,
                    "Content-Encoding": "gzip",
                }

                endpoint = "/react_batch_3p" if self.is_3p else "/react_batch"

                r = requests.post(
                    f"{ot_server_config.server}{endpoint}",
                    headers=headers,
                    data=compressed_data,
                    timeout=OT_REQUEST_TIMEOUT,
                )
                assert r.status_code == 200
                self.is_online = True
                r_json = r.json()
                self.last_inference_result = {
                    "actions": r_json["actions"],
                    "q_out": r_json["q_out"],
                    "masks": r_json["masks"],
                    "is_greedy": r_json["is_greedy"],
                }
                return r_json["actions"], r_json["q_out"], r_json["masks"], r_json["is_greedy"]
            except Exception as e:
                logger.error(f"Online inference failed: {e}")
                self.is_online = False
                pass
        try:
            with (
                torch.autocast(self.device.type, enabled=self.enable_amp),
                torch.inference_mode(),
            ):
                return self._react_batch(obs, masks, invisible_obs)
        except Exception as ex:
            raise RuntimeError(f"Error during inference: {ex}") from ex

    def _react_batch(self, obs, masks, invisible_obs):
        obs = torch.as_tensor(np.stack(obs, axis=0), device=self.device)
        masks = torch.as_tensor(np.stack(masks, axis=0), device=self.device)
        invisible_obs = None
        if self.is_oracle:
            invisible_obs = torch.as_tensor(np.stack(invisible_obs, axis=0), device=self.device)
        batch_size = obs.shape[0]

        match self.version:
            case 3 | 4:
                phi = self.brain(obs)
                q_out = self.dqn(phi, masks)

        if self.boltzmann_epsilon > 0:
            is_greedy = (
                torch.full((batch_size,), 1 - self.boltzmann_epsilon, device=self.device).bernoulli().to(torch.bool)
            )
            logits = (q_out / self.boltzmann_temp).masked_fill(~masks, -torch.inf)
            sampled = sample_top_p(logits, self.top_p)
            actions = torch.where(is_greedy, q_out.argmax(-1), sampled)
        else:
            is_greedy = torch.ones(batch_size, dtype=torch.bool, device=self.device)
            actions = q_out.argmax(-1)

        result_actions = actions.tolist()
        result_q_out = q_out.tolist()
        result_masks = masks.tolist()
        result_is_greedy = is_greedy.tolist()

        self.last_inference_result = {
            "actions": result_actions,
            "q_out": result_q_out,
            "masks": result_masks,
            "is_greedy": result_is_greedy,
        }

        return result_actions, result_q_out, result_masks, result_is_greedy


def sample_top_p(logits, p):
    if p >= 1:
        return Categorical(logits=logits).sample()
    if p <= 0:
        return logits.argmax(-1)
    probs = logits.softmax(-1)
    probs_sort, probs_idx = probs.sort(-1, descending=True)
    probs_sum = probs_sort.cumsum(-1)
    mask = probs_sum - probs_sort > p
    probs_sort[mask] = 0.0
    sampled = probs_idx.gather(-1, probs_sort.multinomial(1)).squeeze(-1)
    return sampled
