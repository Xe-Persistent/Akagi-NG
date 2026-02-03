from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from akagi_ng.dataserver.api import _is_allowed_origin, cors_middleware, setup_routes


@pytest.fixture
async def cli():
    app = web.Application(middlewares=[cors_middleware])
    setup_routes(app)
    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    yield client
    await client.close()


def test_is_allowed_origin():
    assert _is_allowed_origin(None) is True
    assert _is_allowed_origin("http://localhost:3000") is True
    assert _is_allowed_origin("http://127.0.0.1:8080") is True
    assert _is_allowed_origin("http://malicious.com") is False


async def test_cors_middleware_allowed(cli):
    resp = await cli.get("/api/settings", headers={"Origin": "http://localhost:3000"})
    assert resp.status == 200
    assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"


async def test_cors_middleware_forbidden(cli):
    resp = await cli.get("/api/settings", headers={"Origin": "http://evil.com"})
    assert resp.status == 403


async def test_get_settings(cli):
    with patch("akagi_ng.dataserver.api.get_settings_dict", return_value={"test": "val"}):
        resp = await cli.get("/api/settings")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True
        assert data["data"] == {"test": "val"}


async def test_save_settings_invalid_json(cli):
    resp = await cli.post("/api/settings", data="not json")
    assert resp.status == 400
    data = await resp.json()
    assert data["ok"] is False


async def test_save_settings_validation_failed(cli):
    with patch("akagi_ng.dataserver.api.verify_settings", return_value=False):
        resp = await cli.post("/api/settings", json={"platform": "invalid"})
        assert resp.status == 400
        data = await resp.json()
        assert data["ok"] is False


async def test_save_settings_success(cli):
    with (
        patch("akagi_ng.dataserver.api.verify_settings", return_value=True),
        patch("akagi_ng.dataserver.api.get_settings_dict", return_value={}),
        patch("akagi_ng.dataserver.api.local_settings") as mock_settings,
    ):
        resp = await cli.post("/api/settings", json={"log_level": "DEBUG"})
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True
        assert mock_settings.update.called
        assert mock_settings.save.called


async def test_reset_settings(cli):
    with (
        patch("akagi_ng.dataserver.api.get_default_settings_dict", return_value={"default": True}),
        patch("akagi_ng.dataserver.api.local_settings"),
    ):
        resp = await cli.post("/api/settings/reset")
        assert resp.status == 200
        data = await resp.json()
        assert data["ok"] is True
        assert data["data"] == {"default": True}


async def test_ingest_mjai_success(cli):
    mock_app = MagicMock()
    mock_app.electron_client = MagicMock()

    with patch("akagi_ng.core.get_app_context", return_value=mock_app):
        resp = await cli.post("/api/ingest", json={"type": "tsumo"})
        assert resp.status == 200
        mock_app.electron_client.push_message.assert_called_once_with({"type": "tsumo"})


async def test_ingest_mjai_no_client(cli):
    mock_app = MagicMock()
    mock_app.electron_client = None

    with patch("akagi_ng.core.get_app_context", return_value=mock_app):
        resp = await cli.post("/api/ingest", json={"type": "tsumo"})
        assert resp.status == 503
