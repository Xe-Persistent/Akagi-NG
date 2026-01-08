import numpy as np
import torch
from torch.distributions import Categorical

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.network import get_inference_device


class MortalEngine(BaseEngine):
    def __init__(
        self,
        brain,
        dqn,
        version,
        is_oracle=False,
        device=None,
        stochastic_latent=False,
        name="NoName",
        boltzmann_epsilon=0,
        boltzmann_temp=1,
        top_p=1,
        is_3p=False,
    ):
        super().__init__(is_3p=is_3p, version=version, name=name, is_oracle=is_oracle)

        self.engine_type = "mortal"
        self.device = device or get_inference_device()
        assert isinstance(self.device, torch.device)
        self.brain = brain.to(self.device).eval()
        self.dqn = dqn.to(self.device).eval()

        self.stochastic_latent = stochastic_latent

        self.boltzmann_epsilon = boltzmann_epsilon
        self.boltzmann_temp = boltzmann_temp
        self.top_p = top_p

    def react_batch(self, obs, masks, invisible_obs):
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
            sampled = _sample_top_p(logits, self.top_p)
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


def _sample_top_p(logits, p):
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
