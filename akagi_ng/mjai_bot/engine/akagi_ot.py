import gzip
import json
import time

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

        # Optimization: Hard timeouts (connect, read)
        self.timeout = (2.0, 4.0)

        # Circuit Breaker state
        self._failures = 0
        self._circuit_open = False
        self._last_failure_time = 0
        self._circuit_recovery_period = 30.0  # seconds
        self._failure_threshold = 3

    def predict(self, is_3p: bool, obs: list, masks: list) -> dict:
        # Circuit Breaker Check
        if self._circuit_open:
            if time.time() - self._last_failure_time > self._circuit_recovery_period:
                self._close_circuit()
            else:
                raise RuntimeError("AkagiOT Circuit Breaker is OPEN. Skipping request.")

        # Prepare payload
        post_data = {"obs": obs, "masks": masks}
        data = json.dumps(post_data, separators=(",", ":"))
        compressed_data = gzip.compress(data.encode("utf-8"))

        endpoint = "/react_batch_3p" if is_3p else "/react_batch"
        full_url = f"{self.url}{endpoint}"

        try:
            response = self.session.post(full_url, data=compressed_data, timeout=self.timeout)
            response.raise_for_status()

            # Successful request resets the breaker
            if self._failures > 0:
                self._reset_breaker()

            return response.json()

        except requests.RequestException as e:
            self._record_failure()
            logger.error(f"AkagiOT Request Failed: {e}")
            raise RuntimeError(f"AkagiOT request failed: {e}") from e

    def _record_failure(self):
        self._failures += 1
        self._last_failure_time = time.time()
        if self._failures >= self._failure_threshold:
            self._open_circuit()

    def _open_circuit(self):
        if not self._circuit_open:
            logger.warning(f"AkagiOT Circuit Breaker OPENED after {self._failures} failures.")
            self._circuit_open = True

    def _close_circuit(self):
        logger.info("AkagiOT Circuit Breaker CLOSED (Recovery period passed).")
        self._circuit_open = False
        self._failures = 0
        self._last_failure_time = 0

    def _reset_breaker(self):
        self._failures = 0
        self._circuit_open = False


class AkagiOTEngine(BaseEngine):
    def __init__(self, is_3p: bool, url: str, api_key: str):
        super().__init__(is_3p=is_3p, version=4, name="AkagiOT", is_oracle=False)
        self.client = AkagiOTClient(url, api_key)

        self.is_online = True
        self.engine_type = "akagiot"
        self.last_inference_result = {}

    def get_additional_meta(self) -> dict:
        return {"online": True}

    @property
    def enable_quick_eval(self) -> bool:
        return False

    @property
    def enable_rule_based_agari_guard(self) -> bool:
        return False

    def react_batch(self, obs, masks, invisible_obs):
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
            # Fallback strategy is handled by the upstream Bot class (catching exception -> tsumogiri/none)
            # We just log and re-raise here to signal failure
            logger.warning(f"AkagiOT inference failed, falling back to safe strategy: {e}")
            raise RuntimeError(f"AkagiOT failed: {e}") from e
