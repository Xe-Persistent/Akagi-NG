import gzip
import json
import time
from typing import Self

import numpy as np
import requests

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.constants import ModelConstants
from akagi_ng.schema.notifications import NotificationCode


class AkagiOTClient:
    def __init__(self, url: str, api_key: str):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": self.api_key,
                "Content-Encoding": "gzip",
            }
        )

        # 硬超时（连接、读取）
        # 最多等待 4 秒后触发异常并激活本地模型回退逻辑
        self.timeout = (2.0, 4.0)

        # 熔断器状态
        self._failures = 0
        self._circuit_open = False
        self._last_failure_time = 0
        self._circuit_recovery_period = 30.0  # 秒
        self._failure_threshold = 3  # 次
        self._just_restored = False

    def predict(self, is_3p: bool, obs: list, masks: list, status: BotStatusContext) -> dict:
        # 熔断器检查
        if self._circuit_open:
            if time.time() - self._last_failure_time > self._circuit_recovery_period:
                self._close_circuit()
            else:
                status.set_flag(NotificationCode.RECONNECTING)
                raise RuntimeError("AkagiOT Circuit Breaker is OPEN. Skipping request.")

        # 准备请求负载
        post_data = {"obs": obs, "masks": masks}
        data = json.dumps(post_data, separators=(",", ":"))
        compressed_data = gzip.compress(data.encode("utf-8"))

        endpoint = "/react_batch_3p" if is_3p else "/react_batch"
        full_url = f"{self.url}{endpoint}"

        try:
            response = self.session.post(full_url, data=compressed_data, timeout=self.timeout)
            response.raise_for_status()

            # 请求成功时重置熔断器
            if self._failures > 0:
                self._reset_breaker(status)

            r_json = response.json()

            # [NEW] 协议适配：验证返回维度。
            # 如果是 3P 请求但服务器返回了 46 维（常见于旧版模型分片），进行针对性裁剪。
            expected_dims = ModelConstants.ACTION_DIMS_3P if is_3p else ModelConstants.ACTION_DIMS_4P
            if r_json.get("q_out"):
                actual_dims = len(r_json["q_out"][0])
                if actual_dims != expected_dims:
                    if is_3p and actual_dims == ModelConstants.ACTION_DIMS_4P:
                        logger.warning(
                            "[AkagiOT] Server protocol violation: 3P requested but 46 dims returned. "
                            "Truncating to 44 dims."
                        )
                        # 仅保留前 44 维 (Mortal 3P 动作空间)
                        r_json["q_out"] = [q[: ModelConstants.ACTION_DIMS_3P] for q in r_json["q_out"]]
                        r_json["masks"] = [m[: ModelConstants.ACTION_DIMS_3P] for m in r_json["masks"]]
                    else:
                        logger.error(
                            f"[AkagiOT] Unexpected dimension mismatch: expected {expected_dims}, got {actual_dims}"
                        )

            return r_json

        except requests.RequestException as e:
            self._record_failure(status)
            logger.error(f"AkagiOT Request Failed: {e}")
            raise RuntimeError(f"AkagiOT request failed: {e}") from e

    def _record_failure(self, status: BotStatusContext):
        if self._failures < self._failure_threshold:
            self._failures += 1
        self._last_failure_time = time.time()
        if self._failures >= self._failure_threshold:
            self._open_circuit(status)

    def _open_circuit(self, status: BotStatusContext):
        if not self._circuit_open:
            logger.warning(f"AkagiOT Circuit Breaker OPENED after {self._failures} failures.")
            self._circuit_open = True
            status.set_flag(NotificationCode.RECONNECTING)

    def _close_circuit(self):
        logger.info("AkagiOT Circuit Breaker HALF-OPEN. Probing connection...")
        self._circuit_open = False

    def _reset_breaker(self, status: BotStatusContext):
        logger.info("AkagiOT Circuit Breaker CLOSED. Connection restored, service fully operational.")
        self._failures = 0
        self._circuit_open = False
        status.set_flag(NotificationCode.SERVICE_RESTORED)
        self._just_restored = True


class AkagiOTEngine(BaseEngine):
    def __init__(self, status: BotStatusContext, is_3p: bool, client: AkagiOTClient):
        super().__init__(status=status, is_3p=is_3p, version=4, name="AkagiOT", is_oracle=False)
        self.client = client

        self.is_online = True
        self.engine_type = "akagiot"

    def fork(self, status: BotStatusContext | None = None) -> Self:
        """创建共享 Client 但状态独立的副本"""
        return AkagiOTEngine(status or self.status, self.is_3p, self.client)

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return False

    def react_batch(
        self,
        obs: np.ndarray,
        masks: np.ndarray,
        invisible_obs: np.ndarray | None = None,
        is_sync: bool | None = None,
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        执行在线推理。发生的异常（如连通性问题、超时、熔断）
        将抛回给 EngineProvider 进行回退处理。
        """
        if is_sync is None:
            is_sync = self.is_sync

        # 确保输入为 numpy 数组
        obs = np.asanyarray(obs)
        masks = np.asanyarray(masks)

        # 如果处于显式同步模式，执行极速快进（跳过网络请求）
        if is_sync:
            return self._sync_fast_forward(masks)

        list_obs = obs.tolist()
        list_masks = masks.tolist()

        if self.client._circuit_open:
            self.status.set_metadata(NotificationCode.RECONNECTING, True)
        self.status.set_metadata(NotificationCode.ENGINE_TYPE, self.engine_type)

        r_json = self.client.predict(self.is_3p, list_obs, list_masks, self.status)

        expected_dims = ModelConstants.ACTION_DIMS_3P if self.is_3p else ModelConstants.ACTION_DIMS_4P
        actual_dims = len(r_json["q_out"][0])
        if actual_dims != expected_dims:
            raise RuntimeError(f"Engine output dimension mismatch: expected {expected_dims}, got {actual_dims}")

        # 推理成功后，重置恢复标志（避免在 getter 中产生副作用）
        self.client._just_restored = False

        return r_json["actions"], r_json["q_out"], r_json["masks"], r_json["is_greedy"]
