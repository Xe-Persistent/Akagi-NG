from unittest.mock import MagicMock, patch

import pytest

from akagi_ng.mjai_bot.cloud_api import (
    AkagiApiClient,
    CircuitBreaker,
    CloudApiError,
    normalize_base_url,
)


def response(payload: dict, status: int = 200) -> MagicMock:
    result = MagicMock()
    result.ok = 200 <= status < 300
    result.status_code = status
    result.headers = {}
    result.text = ""
    result.json.return_value = payload
    return result


def test_react_uses_v3_endpoint_bearer_auth_and_optional_model() -> None:
    client = AkagiApiClient("https://api.example/", " secret ")
    client.session.post = MagicMock(return_value=response({"reaction": {"type": "none"}}))

    result = client.react("4p-model", 2, [{"type": "start_game", "names": ["", "", "", ""]}])

    assert result["reaction"]["type"] == "none"
    assert client.session.headers["Authorization"] == "Bearer secret"
    client.session.post.assert_called_once_with(
        "https://api.example/v3/react",
        json={
            "model": "4p-model",
            "player_id": 2,
            "events": [{"type": "start_game", "names": ["", "", "", ""]}],
        },
        timeout=2.0,
    )


def test_models_and_key_status_use_authenticated_v3_endpoints() -> None:
    client = AkagiApiClient("https://api.example", "key")
    client.session.get = MagicMock(
        side_effect=[
            response({"plan": "basic"}),
            response({"models": [{"id": "4p-x", "game": "4p", "desc": "test"}]}),
        ]
    )

    assert client.key_status()["plan"] == "basic"
    assert client.models()[0]["id"] == "4p-x"
    assert client.session.get.call_args_list[0].args[0].endswith("/v3/key")
    assert client.session.get.call_args_list[1].args[0].endswith("/v3/models")


def test_health_and_redeem_are_unauthenticated_management_calls() -> None:
    with (
        patch("akagi_ng.mjai_bot.cloud_api.requests.get", return_value=response({"status": "ok"})) as get,
        patch(
            "akagi_ng.mjai_bot.cloud_api.requests.post",
            return_value=response({"key": "K", "extended": False}),
        ) as post,
    ):
        assert AkagiApiClient.health("https://api.example")["status"] == "ok"
        assert AkagiApiClient.redeem("https://api.example", " CODE ", "user@example.com")["key"] == "K"

    get.assert_called_once_with("https://api.example/healthz", timeout=8.0)
    post.assert_called_once_with(
        "https://api.example/v3/redeem",
        json={"code": "CODE", "email": "user@example.com"},
        timeout=8.0,
    )


def test_http_error_surfaces_server_message_and_retry_after() -> None:
    failed = response({"error": "rate limited"}, status=429)
    failed.headers = {"Retry-After": "12"}
    client = AkagiApiClient("https://api.example", "key")
    client.session.get = MagicMock(return_value=failed)

    with pytest.raises(CloudApiError, match=r"rate limited.*retry after 12s"):
        client.key_status()


def test_circuit_breaker_exponential_backoff_and_recovery() -> None:
    breaker = CircuitBreaker()
    assert breaker.allows(now=0.0)
    assert breaker.record_failure(now=10.0) == (5.0, True)
    assert not breaker.allows(now=14.9)
    assert breaker.allows(now=15.0)
    assert breaker.record_failure(now=20.0) == (10.0, False)
    assert breaker.record_success() is True
    assert breaker.allows(now=20.0)


def test_invalid_base_url_is_rejected() -> None:
    with pytest.raises(CloudApiError):
        normalize_base_url("localhost:8080")
