from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Self

import numpy as np
import torch
from torch.distributions import Categorical, Normal

from akagi_ng.core.constants import ModelConstants
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.network import DQN, Brain, get_inference_device


@dataclass
class MortalModelResource:
    """
    持有 Mortal 模型核心资源的容器。
    这些资源在多个 Bot 实例间共享，以减少显存占用。
    Warmup 也在资源加载阶段完成。
    """

    brain: torch.nn.Module
    dqn: torch.nn.Module
    version: int
    device: torch.device
    stochastic_latent: bool
    boltzmann_epsilon: float
    boltzmann_temp: float
    top_p: float
    engine_name: str
    enable_amp: bool


class MortalEngine(BaseEngine):
    def __init__(self, resource: MortalModelResource, is_3p: bool):
        super().__init__(is_3p=is_3p, version=resource.version, name=resource.engine_name, is_oracle=False)
        self.resource = resource
        self.engine_type = "mortal"
        self.device = resource.device

    @property
    def enable_amp(self) -> bool:
        return self.resource.enable_amp

    def fork(self) -> Self:
        """创建共享模型资源的副本"""
        return MortalEngine(self.resource, self.is_3p)

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        if is_sync is None:
            is_sync = self.is_sync

        # 确保输入为 numpy 数组
        obs = np.asanyarray(obs)
        masks = np.asanyarray(masks)

        # 如果处于显式同步模式，执行极速快进（跳过神经网络）
        if is_sync:
            return self._sync_fast_forward(masks)

        try:
            with (
                torch.autocast(self.device.type, enabled=self.enable_amp),
                torch.inference_mode(),
            ):
                return self._react_batch(obs, masks, invisible_obs)
        except Exception as ex:
            raise RuntimeError(f"Error during inference: {ex}") from ex

    def _react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        # 使用 resource 中的对象
        brain = self.resource.brain
        dqn = self.resource.dqn
        version = self.resource.version
        stochastic_latent = self.resource.stochastic_latent
        boltzmann_epsilon = self.resource.boltzmann_epsilon
        boltzmann_temp = self.resource.boltzmann_temp
        top_p = self.resource.top_p

        obs_t = torch.as_tensor(obs, device=self.device)
        masks_t = torch.as_tensor(masks, device=self.device)
        inv_obs_t = torch.as_tensor(invisible_obs, device=self.device) if invisible_obs is not None else None
        batch_size = obs_t.shape[0]
        q_out = None
        match version:
            case ModelConstants.MODEL_VERSION_1:
                mu, logsig = brain(obs_t, inv_obs_t)
                latent = Normal(mu, logsig.exp() + 1e-6).sample() if stochastic_latent else mu
                q_out = dqn(latent, masks_t)
            case ModelConstants.MODEL_VERSION_2 | ModelConstants.MODEL_VERSION_3 | ModelConstants.MODEL_VERSION_4:
                phi = brain(obs_t)
                q_out = dqn(phi, masks_t)
            case _:
                raise ValueError(f"Unsupported Mortal version: {version}")

        if boltzmann_epsilon > 0:
            is_greedy = torch.full((batch_size,), 1 - boltzmann_epsilon, device=self.device).bernoulli().to(torch.bool)
            logits = (q_out / boltzmann_temp).masked_fill(~masks_t, -torch.inf)
            sampled = _sample_top_p(logits, top_p)
            actions = torch.where(is_greedy, q_out.argmax(-1), sampled)
        else:
            is_greedy = torch.ones(batch_size, dtype=torch.bool, device=self.device)
            actions = q_out.argmax(-1)

        result_actions = actions.tolist()
        result_q_out = q_out.tolist()
        result_masks = masks_t.tolist()
        result_is_greedy = is_greedy.tolist()

        return result_actions, result_q_out, result_masks, result_is_greedy


def _sample_top_p(logits: torch.Tensor, p: float) -> torch.Tensor:
    if p >= 1:
        return Categorical(logits=logits).sample()
    if p <= 0:
        return logits.argmax(-1)
    probs = logits.softmax(-1)
    probs_sort, probs_idx = probs.sort(-1, descending=True)
    probs_sum = probs_sort.cumsum(-1)
    mask = probs_sum - probs_sort > p
    probs_sort[mask] = 0.0
    return probs_idx.gather(-1, probs_sort.multinomial(1)).squeeze(-1)


def load_mortal_resource(
    model_path: Path,
    consts: ModuleType,
    is_3p: bool = False,
) -> MortalModelResource | None:
    """
    加载本地 Mortal 模型并返回资源对象。
    """
    if not model_path.exists():
        return None

    try:
        device = get_inference_device()
        state = torch.load(model_path, map_location=device, weights_only=False)

        # 提取配置版本
        cfg = state["config"]
        control_version = cfg["control"]["version"]
        conv_channels = cfg["resnet"]["conv_channels"]
        num_blocks = cfg["resnet"]["num_blocks"]

        # 检测是否为 policy_net 模式 (CategoricalPolicy + GroupNorm)
        is_policy_model = "policy_net" in state
        norm_type = "GN" if is_policy_model else "BN"
        dqn_key = "policy_net" if is_policy_model else "current_dqn"

        from akagi_ng.mjai_bot.network import CategoricalPolicy

        mortal = Brain(
            obs_shape_func=consts.obs_shape,
            oracle_obs_shape_func=consts.oracle_obs_shape,
            version=control_version,
            conv_channels=conv_channels,
            num_blocks=num_blocks,
            norm_type=norm_type,
        ).eval()

        if is_policy_model:
            dqn = CategoricalPolicy(action_space=consts.ACTION_SPACE).eval()
            engine_name = "policy"
        else:
            dqn = DQN(action_space=consts.ACTION_SPACE, version=control_version).eval()
            engine_name = "mortal"

        mortal.load_state_dict(state["mortal"])
        dqn.load_state_dict(state[dqn_key])

        # 转移到设备
        mortal = mortal.to(device)
        dqn = dqn.to(device)

        resource = MortalModelResource(
            brain=mortal,
            dqn=dqn,
            version=control_version,
            device=device,
            stochastic_latent=False,  # Default
            boltzmann_epsilon=0,  # Default
            boltzmann_temp=1,  # Default
            top_p=1,  # Default
            engine_name=engine_name,
            enable_amp=False,  # Default
        )

        logger.info(f"Local Mortal ({'3P' if is_3p else '4P'}) resource loaded successfully.")
        return resource

    except Exception as e:
        logger.error(f"Failed to load local Mortal ({'3P' if is_3p else '4P'}) resource: {e}")
        return None
