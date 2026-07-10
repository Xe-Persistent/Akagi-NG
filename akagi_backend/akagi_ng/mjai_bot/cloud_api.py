"""Client and resilience primitives for Akagi's V3 cloud-inference API.

The V3 service is stateless: each decision uploads the current kyoku's
seat-censored MJAI stream to ``POST /v3/react``.  Management endpoints mirror
Akagi v3.3 so the desktop UI can inspect health, key limits, and available
models without exposing the key in a URL.
"""

import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import requests

MANAGEMENT_TIMEOUT_SECONDS = 8.0
REACT_TIMEOUT_SECONDS = 2.0
BREAKER_BASE_SECONDS = 5.0
BREAKER_MAX_SECONDS = 120.0


class CloudApiError(RuntimeError):
    """A transport, HTTP, or response-shape error from the cloud API."""


def normalize_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise CloudApiError("API base URL must be an absolute http(s) URL")
    return normalized


def _response_error(response: requests.Response, what: str) -> CloudApiError:
    message = response.text[:200]
    try:
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("error"), str):
            message = payload["error"]
    except ValueError:
        pass

    retry_after = response.headers.get("Retry-After")
    suffix = f" (retry after {retry_after}s)" if retry_after else ""
    return CloudApiError(f"{what} failed: HTTP {response.status_code} - {message}{suffix}")


def _json_object(response: requests.Response, what: str) -> dict[str, Any]:
    if not response.ok:
        raise _response_error(response, what)
    try:
        payload = response.json()
    except ValueError as exc:
        raise CloudApiError(f"{what} returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise CloudApiError(f"{what} returned a non-object JSON response")
    return payload


class AkagiApiClient:
    """Authenticated, connection-pooled client bound to one server and key."""

    def __init__(self, base_url: str, key: str):
        self.base_url = normalize_base_url(base_url)
        self.key = key.strip()
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {self.key}"})

    def react(self, model: str, player_id: int, events: list[dict[str, Any]]) -> dict[str, Any]:
        body: dict[str, Any] = {"player_id": player_id, "events": events}
        if normalized_model := model.strip():
            body["model"] = normalized_model
        response = self.session.post(
            f"{self.base_url}/v3/react",
            json=body,
            timeout=REACT_TIMEOUT_SECONDS,
        )
        return _json_object(response, "react")

    def key_status(self) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/v3/key",
            timeout=MANAGEMENT_TIMEOUT_SECONDS,
        )
        return _json_object(response, "key status")

    def models(self) -> list[dict[str, Any]]:
        response = self.session.get(
            f"{self.base_url}/v3/models",
            timeout=MANAGEMENT_TIMEOUT_SECONDS,
        )
        payload = _json_object(response, "models")
        models = payload.get("models", [])
        if not isinstance(models, list) or not all(isinstance(model, dict) for model in models):
            raise CloudApiError("models returned an invalid model list")
        return models

    @staticmethod
    def health(base_url: str) -> dict[str, Any]:
        base = normalize_base_url(base_url)
        response = requests.get(f"{base}/healthz", timeout=MANAGEMENT_TIMEOUT_SECONDS)
        return _json_object(response, "health")

    @staticmethod
    def redeem(
        base_url: str,
        code: str,
        email: str | None = None,
        renew_key: str | None = None,
    ) -> dict[str, Any]:
        base = normalize_base_url(base_url)
        body: dict[str, str] = {"code": code.strip()}
        if normalized_email := (email or "").strip():
            body["email"] = normalized_email
        if normalized_key := (renew_key or "").strip():
            body["renew_key"] = normalized_key
        response = requests.post(
            f"{base}/v3/redeem",
            json=body,
            timeout=MANAGEMENT_TIMEOUT_SECONDS,
        )
        return _json_object(response, "redeem")


@dataclass(slots=True)
class CircuitBreaker:
    """Exponential 5s..120s backoff matching Akagi v3.3's live fallback."""

    healthy: bool = True
    consecutive_failures: int = 0
    open_until: float | None = None

    def allows(self, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        return self.open_until is None or current >= self.open_until

    def record_success(self) -> bool:
        recovered = not self.healthy
        self.healthy = True
        self.consecutive_failures = 0
        self.open_until = None
        return recovered

    def record_failure(self, now: float | None = None) -> tuple[float, bool]:
        current = time.monotonic() if now is None else now
        was_healthy = self.healthy
        self.healthy = False
        self.consecutive_failures += 1
        backoff = min(
            BREAKER_BASE_SECONDS * (2 ** (self.consecutive_failures - 1)),
            BREAKER_MAX_SECONDS,
        )
        self.open_until = current + backoff
        return backoff, was_healthy

    def reset(self) -> None:
        self.healthy = True
        self.consecutive_failures = 0
        self.open_until = None
