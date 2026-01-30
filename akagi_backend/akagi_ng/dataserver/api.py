import json
from collections.abc import Callable

from aiohttp import web

from akagi_ng.core import configure_logging
from akagi_ng.dataserver.logger import logger
from akagi_ng.settings import get_default_settings_dict, get_settings_dict, local_settings, verify_settings

# CORS Headers configuration
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


@web.middleware
async def cors_middleware(request: web.Request, handler: Callable[[web.Request], web.StreamResponse]) -> web.Response:
    """Add CORS headers to all responses."""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS_HEADERS)
    response = await handler(request)
    response.headers.update({"Access-Control-Allow-Origin": "*"})
    return response


def _json_response(data: dict, status: int = 200) -> web.Response:
    """Helper to create JSON response with ensure_ascii=False."""
    return web.json_response(
        data,
        status=status,
        dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
    )


async def get_settings_handler(_request: web.Request) -> web.Response:
    return _json_response({"ok": True, "data": get_settings_dict()})


async def save_settings_handler(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    if not isinstance(payload, dict):
        return _json_response({"ok": False, "error": "Settings payload must be a JSON object"}, status=400)

    if not verify_settings(payload):
        return _json_response({"ok": False, "error": "Settings validation failed (schema mismatch)"}, status=400)

    old_settings = get_settings_dict()
    local_settings.update(payload)
    local_settings.save()

    restart_required = False

    if payload.get("log_level") != old_settings.get("log_level"):
        new_level = payload.get("log_level", "INFO")
        logger.info(f"Log level changed to {new_level}, updating...")
        configure_logging(new_level)

    if (
        payload.get("game_url") != old_settings.get("game_url")
        or payload.get("platform") != old_settings.get("platform")
        or payload.get("mitm") != old_settings.get("mitm")
        or payload.get("server") != old_settings.get("server")
        or payload.get("ot") != old_settings.get("ot")
        or payload.get("model_config", {}).get("device") != old_settings.get("model_config", {}).get("device")
    ):
        restart_required = True

    return _json_response({"ok": True, "restartRequired": restart_required})


async def reset_settings_handler(_request: web.Request) -> web.Response:
    default_settings = get_default_settings_dict()
    local_settings.update(default_settings)
    local_settings.save()
    return _json_response({"ok": True, "data": default_settings, "restartRequired": True})


async def ingest_mjai_handler(request: web.Request) -> web.Response:
    """接收 Electron 发送的 MJAI 消息"""
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Ingest JSON error: {e}")
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    try:
        from akagi_ng.core import context

        if context.app.electron_client:
            context.app.electron_client.push_message(payload)
            return _json_response({"ok": True})

        logger.warning("ElectronClient is not active")
        return _json_response({"ok": False, "error": "ElectronClient not active"}, status=503)
    except Exception as e:
        import traceback

        traceback.print_exc()
        logger.error(f"Ingest handler error: {e}")
        return _json_response({"ok": False, "error": str(e)}, status=500)


def setup_routes(app: web.Application):
    app.router.add_get("/api/settings", get_settings_handler)
    app.router.add_post("/api/settings", save_settings_handler)
    app.router.add_post("/api/settings/reset", reset_settings_handler)
    app.router.add_post("/api/ingest", ingest_mjai_handler)
