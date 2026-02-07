import gzip
import json
import time

import numpy as np
import requests

from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.logger import logger


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
        self._failure_threshold = 3
        self._just_restored = False

        # 启动背景连接预热
        self._pre_warm_connection()

    def _pre_warm_connection(self):
        """发送一个轻量级的 OPTIONS 请求以预热 TCP/TLS 连接。"""
        try:
            import threading

            def _warm():
                try:
                    # 使用 OPTIONS 或 HEAD 以最小化开销
                    self.session.options(self.url, timeout=2.0)
                    logger.info(f"AkagiOT: Connection pre-warmed for {self.url}")
                except Exception:
                    pass

            threading.Thread(target=_warm, daemon=True).start()
        except Exception as e:
            logger.warning(f"AkagiOT: Pre-warm failed: {e}")

    def predict(self, is_3p: bool, obs: list, masks: list) -> dict:
        # 熔断器检查
        if self._circuit_open:
            if time.time() - self._last_failure_time > self._circuit_recovery_period:
                self._close_circuit()
            else:
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
                self._reset_breaker()

            return response.json()

        except requests.RequestException as e:
            self._record_failure()
            logger.error(f"AkagiOT Request Failed: {e}")
            raise RuntimeError(f"AkagiOT request failed: {e}") from e

    def _record_failure(self):
        if self._failures < self._failure_threshold:
            self._failures += 1
        self._last_failure_time = time.time()
        if self._failures >= self._failure_threshold:
            self._open_circuit()

    def _open_circuit(self):
        if not self._circuit_open:
            logger.warning(f"AkagiOT Circuit Breaker OPENED after {self._failures} failures.")
            self._circuit_open = True

    def _close_circuit(self):
        logger.info("AkagiOT Circuit Breaker HALF-OPEN. Probing connection...")
        self._circuit_open = False

    def _reset_breaker(self):
        logger.info("AkagiOT Circuit Breaker CLOSED. Connection restored, service fully operational.")
        self._failures = 0
        self._circuit_open = False
        self._just_restored = True


class AkagiOTEngine(BaseEngine):
    def __init__(self, is_3p: bool, url: str, api_key: str):
        super().__init__(is_3p=is_3p, version=4, name="AkagiOT", is_oracle=False)
        self.client = AkagiOTClient(url, api_key)

        self.is_online = True
        self.engine_type = "akagiot"

    def get_notification_flags(self) -> dict[str, object]:
        """返回 AkagiOT 引擎的通知标志。"""
        flags = {}
        if self.client._circuit_open:
            flags["circuit_open"] = True
        if self.client._just_restored:
            flags["circuit_restored"] = True
            self.client._just_restored = False
        return flags

    def get_additional_meta(self) -> dict[str, object]:
        return {"circuit_open": self.client._circuit_open}

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return False

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        """
        执行在线推理。发生的异常（如连通性问题、超时、熔断）
        将抛回给 EngineProvider 进行回退处理。
        """
        # 鲁棒性：确保输入为 numpy 数组
        obs = np.asanyarray(obs)
        masks = np.asanyarray(masks)

        # 如果处于显式同步模式，执行极速快进（跳过网络请求）
        if self.is_sync_mode:
            batch_size = obs.shape[0]
            # 找到每一行第一个为 True 的索引
            actions = [int(np.where(m)[0][0]) for m in masks]
            # 同步模式下不进行预测，返回零 Q 值
            q_values = [[0.0] * masks.shape[1] for _ in range(batch_size)]
            is_greedy = [True] * batch_size
            return actions, q_values, masks.tolist(), is_greedy

        list_obs = [o.tolist() for o in obs]
        list_masks = [m.tolist() for m in masks]

        r_json = self.client.predict(self.is_3p, list_obs, list_masks)

        self.last_inference_result = {
            "actions": r_json["actions"],
            "q_out": r_json["q_out"],
            "masks": r_json["masks"],
            "is_greedy": r_json["is_greedy"],
        }

        return r_json["actions"], r_json["q_out"], r_json["masks"], r_json["is_greedy"]
