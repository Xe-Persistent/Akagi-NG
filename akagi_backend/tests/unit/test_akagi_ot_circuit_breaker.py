from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import requests

from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.provider import EngineProvider

type InferenceResult = tuple[list[int], list[list[float]], list[list[bool]], list[bool]]


class MockFallbackEngine(BaseEngine):
    """
    使用现代语法的模拟本地引擎。
    """

    def __init__(self) -> None:
        super().__init__(is_3p=False, version=1, name="MockFallback", is_oracle=False)
        self.call_count: int = 0
        self.engine_type: str = "mortal"

    def react_batch(self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray | None) -> InferenceResult:
        self.call_count += 1
        batch_size = obs.shape[0]
        # 返回 54 维动作空间的全假响应
        actions = [0] * batch_size
        q_out = [[0.0] * 54 for _ in range(batch_size)]
        masks_out = [[False] * 54 for _ in range(batch_size)]
        is_greedy = [True] * batch_size
        return actions, q_out, masks_out, is_greedy


@pytest.fixture
def fallback_engine() -> MockFallbackEngine:
    return MockFallbackEngine()


@pytest.fixture
def ot_engine() -> AkagiOTEngine:
    return AkagiOTEngine(is_3p=False, url="http://fake-server", api_key="fake-key")


@pytest.fixture
def engine_provider(ot_engine: AkagiOTEngine, fallback_engine: MockFallbackEngine) -> EngineProvider:
    return EngineProvider(ot_engine, fallback_engine, is_3p=False)


@pytest.fixture
def mock_inputs() -> dict[str, np.ndarray]:
    obs = np.zeros((1, 93, 34))
    masks = np.zeros((1, 54), dtype=bool)
    masks[0, 5] = True  # 随便设一个动作
    invisible_obs = np.zeros((1, 93, 34))
    return {"obs": obs, "masks": masks, "invisible_obs": invisible_obs}


def test_circuit_breaker_complete_flow(
    engine_provider: EngineProvider,
    ot_engine: AkagiOTEngine,
    fallback_engine: MockFallbackEngine,
    mock_inputs: dict[str, np.ndarray],
) -> None:
    """
    测试 Akagi-OT 熔断器完整生命周期：
    1. 连续失败导致熔断开启。
    2. 开启状态下的快速失败回退。
    3. 等待冷却后的恢复探测。
    """
    obs, masks, invisible_obs = mock_inputs["obs"], mock_inputs["masks"], mock_inputs["invisible_obs"]

    with patch("requests.Session.post") as mock_post:
        # --- 阶段 1: 故障触发熔断 ---
        mock_post.side_effect = requests.ConnectionError("Network Down")

        # 默认 3 次失败触发熔断
        for i in range(1, 4):
            engine_provider.react_batch(obs, masks, invisible_obs)
            assert fallback_engine.call_count == i
            assert ot_engine.client._failures == i

        assert ot_engine.client._circuit_open is True

        # --- 阶段 2: 快速失败 ---
        mock_post.reset_mock()
        engine_provider.react_batch(obs, masks, invisible_obs)

        # 熔断开启应直接跳过网络请求
        mock_post.assert_not_called()
        assert fallback_engine.call_count == 4

        # --- 阶段 3: 恢复探测 ---
        # 模拟 31 秒后
        last_failure = ot_engine.client._last_failure_time
        with patch("time.time", return_value=last_failure + 31):
            # 这次请求成功
            mock_post.side_effect = None
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "actions": [5],
                "q_out": [[0.8] * 54],
                "masks": [masks[0].tolist()],
                "is_greedy": [True],
            }
            mock_post.return_value = mock_resp

            actions, _, _, _ = engine_provider.react_batch(obs, masks, invisible_obs)

            # 应该发起了网络请求尝试探测
            mock_post.assert_called_once()
            # 探测成功，熔断闭合
            assert ot_engine.client._circuit_open is False
            assert ot_engine.client._failures == 0
            assert actions == [5]
