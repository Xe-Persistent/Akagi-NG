from pathlib import Path
from types import ModuleType

import numpy as np
import torch
from torch.distributions import Categorical, Normal

from akagi_ng.core.constants import ModelConstants
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.network import DQN, Brain, get_inference_device


class MortalEngine(BaseEngine):
    def __init__(  # noqa: PLR0913
        self,
        brain: torch.nn.Module,
        dqn: torch.nn.Module,
        version: int,
        is_oracle: bool = False,
        device: torch.device | None = None,
        stochastic_latent: bool = False,
        name: str = "NoName",
        boltzmann_epsilon: float = 0,
        boltzmann_temp: float = 1,
        top_p: float = 1,
        is_3p: bool = False,
    ):
        super().__init__(is_3p=is_3p, version=version, name=name, is_oracle=is_oracle)

        self.engine_type = "mortal"
        self.device = device or get_inference_device()
        self.brain = brain.to(self.device).eval()
        self.dqn = dqn.to(self.device).eval()

        self.stochastic_latent = stochastic_latent

        self.boltzmann_epsilon = boltzmann_epsilon
        self.boltzmann_temp = boltzmann_temp
        self.top_p = top_p

    def warmup(self):
        """执行一次 dummy 推理以预热 CUDA/CPU 内核，消除首个真实请求的卡顿。"""
        try:
            # 动态检测模型输入维度
            # Brain.encoder.net[0] 是第一个 Conv1d 层
            in_channels = self.brain.encoder.net[0].in_channels
            action_space = self.dqn.action_space

            # 构造最小规模的有效观测
            # 观测维由 Brain.encoder 决定，通常是 (B, C, 34)
            obs = np.zeros((1, in_channels, 34), dtype=np.float32)
            masks = np.ones((1, action_space), dtype=bool)
            invisible_obs = np.zeros((1, in_channels, 34), dtype=np.float32)

            logger.debug(f"MortalEngine ({self.name}): Warming up engine with shape (1, {in_channels}, 34)...")
            self.react_batch(obs, masks, invisible_obs)
            logger.info(f"MortalEngine ({self.name}): Warmup completed.")
        except Exception as e:
            logger.warning(f"MortalEngine warmup failed: {e}")

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        # 确保输入为 numpy 数组
        obs = np.asanyarray(obs)
        masks = np.asanyarray(masks)

        # 如果处于显式同步模式，执行极速快进（跳过神经网络）
        if self.is_sync_mode:
            batch_size = obs.shape[0]
            # np.argmax 返回第一个 True 的索引，符合最低合法动作原则
            fast_actions = np.argmax(masks, axis=1).tolist()
            q_out = [[0.0] * masks.shape[1] for _ in range(batch_size)]
            clean_masks = masks.tolist()
            is_greedy = [True] * batch_size

            self.last_inference_result = {
                "actions": fast_actions,
                "q_out": q_out,
                "masks": clean_masks,
                "is_greedy": is_greedy,
            }
            return fast_actions, q_out, clean_masks, is_greedy

        try:
            with (
                torch.autocast(self.device.type, enabled=False),
                torch.inference_mode(),
            ):
                return self._react_batch(obs, masks, invisible_obs)
        except Exception as ex:
            raise RuntimeError(f"Error during inference: {ex}") from ex

    def _react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        obs_t = torch.as_tensor(np.stack(obs, axis=0), device=self.device)
        masks_t = torch.as_tensor(np.stack(masks, axis=0), device=self.device)
        inv_obs_t = (
            torch.as_tensor(np.stack(invisible_obs, axis=0), device=self.device) if invisible_obs is not None else None
        )
        batch_size = obs_t.shape[0]
        q_out = None
        match self.version:
            case ModelConstants.MODEL_VERSION_1:
                mu, logsig = self.brain(obs_t, inv_obs_t)
                latent = Normal(mu, logsig.exp() + 1e-6).sample() if self.stochastic_latent else mu
                q_out = self.dqn(latent, masks_t)
            case ModelConstants.MODEL_VERSION_2 | ModelConstants.MODEL_VERSION_3 | ModelConstants.MODEL_VERSION_4:
                phi = self.brain(obs_t)
                q_out = self.dqn(phi, masks_t)
            case _:
                raise ValueError(f"Unsupported Mortal version: {self.version}")

        if self.boltzmann_epsilon > 0:
            is_greedy = (
                torch.full((batch_size,), 1 - self.boltzmann_epsilon, device=self.device).bernoulli().to(torch.bool)
            )
            logits = (q_out / self.boltzmann_temp).masked_fill(~masks_t, -torch.inf)
            sampled = _sample_top_p(logits, self.top_p)
            actions = torch.where(is_greedy, q_out.argmax(-1), sampled)
        else:
            is_greedy = torch.ones(batch_size, dtype=torch.bool, device=self.device)
            actions = q_out.argmax(-1)

        result_actions = actions.tolist()
        result_q_out = q_out.tolist()
        result_masks = masks_t.tolist()
        result_is_greedy = is_greedy.tolist()

        self.last_inference_result = {
            "actions": result_actions,
            "q_out": result_q_out,
            "masks": result_masks,
            "is_greedy": result_is_greedy,
        }

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


def load_local_mortal_engine(
    model_path: Path,
    consts: ModuleType,
    is_3p: bool = False,
) -> MortalEngine | None:
    """
    加载本地 Mortal 模型并返回 MortalEngine。
    如果文件未找到或加载失败则返回 None。
    """

    if not model_path.exists():
        return None

    try:
        state = torch.load(model_path, map_location=get_inference_device(), weights_only=False)

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

        engine = MortalEngine(
            mortal,
            dqn,
            is_oracle=False,
            version=control_version,
            name=engine_name,
            is_3p=is_3p,
        )
        engine.warmup()
        logger.info(f"Local Mortal ({'3P' if is_3p else '4P'}) model loaded successfully.")
        return engine

    except Exception as e:
        logger.error(f"Failed to load local Mortal ({'3P' if is_3p else '4P'}) model: {e}")
        return None
