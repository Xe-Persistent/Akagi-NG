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
    def __init__(self, is_3p: bool, url: str, api_key: str, fallback_engine: BaseEngine = None):
        super().__init__(is_3p=is_3p, version=4, name="AkagiOT", is_oracle=False)
        self.client = AkagiOTClient(url, api_key)

        self.is_online = True
        self.engine_type = "akagiot"
        self.last_inference_result = {}
        self.fallback_engine = fallback_engine

        if self.fallback_engine:
            logger.info(f"AkagiOT: Fallback engine configured: {self.fallback_engine.name}")

    def get_notification_flags(self) -> dict:
        """返回 AkagiOT 引擎的通知标志。"""
        flags = {}
        if self.client._circuit_open:
            flags["circuit_open"] = True
            flags["fallback_used"] = True
        if self.client._just_restored:
            flags["circuit_restored"] = True
            self.client._just_restored = False
        # fallback_used 标志由 MortalBot 在检测到 fallback 时设置
        return flags

    @property
    def enable_quick_eval(self) -> bool:
        return False

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return False

    def react_batch(
        self, obs: np.ndarray, masks: np.ndarray, invisible_obs: np.ndarray
    ) -> tuple[list[int], list[list[float]], list[list[bool]], list[bool]]:
        try:
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

        except Exception as e:
            if self.fallback_engine:
                logger.warning(f"AkagiOT inference failed: {e}. Switching to Fallback Engine.")
                try:
                    # 委托给回退引擎
                    res = self.fallback_engine.react_batch(obs, masks, invisible_obs)

                    # 用回退数据更新 last_inference_result
                    self.last_inference_result = {
                        "actions": res[0],
                        "q_out": res[1],
                        "masks": res[2],
                        "is_greedy": res[3],
                    }
                    return res
                except Exception as fallback_err:
                    logger.error(f"Fallback engine also failed: {fallback_err}")
                    raise RuntimeError(f"AkagiOT and Fallback both failed: {e}") from e
            else:
                # 回退策略由上游 Bot 类处理
                logger.warning(f"AkagiOT inference failed, no fallback configured: {e}")
                raise RuntimeError(f"AkagiOT failed: {e}") from e
