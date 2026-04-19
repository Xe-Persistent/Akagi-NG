import json
import queue
from collections.abc import Callable

from aiohttp import web

from akagi_ng.bridge.majsoul.modifier import (
    get_default_mod_settings_dict,
    load_mod_settings_dict,
    save_mod_settings_dict,
    verify_mod_settings_dict,
)
from akagi_ng.core.context import get_app_context
from akagi_ng.core.logging import configure_logging
from akagi_ng.core.paths import get_models_dir
from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot.engine import clear_resource_cache
from akagi_ng.schema.types import (
    DebuggerDetachedMessage,
    LiqiDefinitionMessage,
    SystemShutdownEvent,
    WebSocketClosedMessage,
    WebSocketCreatedMessage,
    WebSocketFrameMessage,
)
from akagi_ng.settings import (
    get_default_settings_dict,
    get_settings_dict,
    local_settings,
    verify_settings,
)

CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True
    return any(token in origin for token in ("localhost", "127.0.0.1", "maj-soul", "majsoul", "mahjongsoul"))


@web.middleware
async def cors_middleware(request: web.Request, handler: Callable[[web.Request], web.StreamResponse]) -> web.Response:
    origin = request.headers.get("Origin")

    if not _is_allowed_origin(origin):
        logger.warning(f"Blocked CORS request from unauthorized origin: {origin}")
        return web.Response(status=403, text="Forbidden: Invalid origin")

    allow_origin = origin if origin else "*"

    if request.method == "OPTIONS":
        headers = dict(CORS_HEADERS)
        headers["Access-Control-Allow-Origin"] = allow_origin
        return web.Response(status=204, headers=headers)

    response = await handler(request)
    response.headers.update({"Access-Control-Allow-Origin": allow_origin})
    return response


def _json_response(data: dict, status: int = 200) -> web.Response:
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

    try:
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

        clear_resource_cache()
        logger.info("Resource cache cleared due to settings update.")
        return _json_response({"ok": True, "restartRequired": restart_required})
    except Exception:
        logger.exception("Failed to save settings")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def reset_settings_handler(_request: web.Request) -> web.Response:
    try:
        default_settings = get_default_settings_dict()
        local_settings.update(default_settings)
        local_settings.save()

        clear_resource_cache()
        logger.info("Resource cache cleared due to settings reset.")
        return _json_response({"ok": True, "data": default_settings, "restartRequired": True})
    except Exception:
        logger.exception("Failed to reset settings")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def get_models_handler(_request: web.Request) -> web.Response:
    models_dir = get_models_dir()
    if not models_dir.exists():
        return _json_response({"ok": True, "data": []})

    models = [f.name for f in models_dir.glob("*.pth") if f.is_file()]
    return _json_response({"ok": True, "data": models})


async def get_majsoul_mod_settings_handler(_request: web.Request) -> web.Response:
    return _json_response({"ok": True, "data": load_mod_settings_dict()})


async def save_majsoul_mod_settings_handler(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    if not verify_mod_settings_dict(payload):
        return _json_response({"ok": False, "error": "Majsoul mod settings validation failed"}, status=400)

    try:
        current = load_mod_settings_dict()
        current.update({k: v for k, v in payload.items() if k in ("enabled", "config", "resource")})
        save_mod_settings_dict(current)
        return _json_response({"ok": True, "data": current})
    except Exception:
        logger.exception("Failed to save Majsoul mod settings")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def reset_majsoul_mod_settings_handler(_request: web.Request) -> web.Response:
    try:
        default_settings = get_default_mod_settings_dict()
        save_mod_settings_dict(default_settings)
        return _json_response({"ok": True, "data": default_settings})
    except Exception:
        logger.exception("Failed to reset Majsoul mod settings")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def ingest_mjai_handler(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Ingest JSON error: {e}")
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    try:
        match payload:
            case {"type": "websocket_created", "url": url}:
                msg = WebSocketCreatedMessage(url=url)
            case {"type": "websocket_closed"}:
                msg = WebSocketClosedMessage()
            case {"type": "websocket", "direction": direction, "data": data}:
                msg = WebSocketFrameMessage(direction=direction, data=data, opcode=payload.get("opcode"))
            case {"type": "liqi_definition", "data": data}:
                msg = LiqiDefinitionMessage(data=data)
            case {"type": "debugger_detached"}:
                msg = DebuggerDetachedMessage()
            case _:
                logger.warning(f"Invalid MJAI ingest payload: {payload}")
                return _json_response({"ok": False, "error": "Invalid MJAI payload structure"}, status=400)
    except (KeyError, TypeError) as e:
        logger.warning(f"Error parsing ingest payload: {e}")
        return _json_response({"ok": False, "error": f"Payload parsing error: {e}"}, status=400)

    try:
        app = get_app_context()
        if app.electron_client:
            result = app.electron_client.push_message(msg)
            response = {"ok": True}
            if isinstance(result, dict):
                response["mutation"] = result
            return _json_response(response)

        logger.warning("ElectronClient is not active")
        return _json_response({"ok": False, "error": "ElectronClient not active"}, status=503)
    except Exception as e:
        logger.error(f"Ingest handler error: {e}")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def shutdown_handler(_request: web.Request) -> web.Response:
    logger.info("Received shutdown request from api.")

    try:
        app = get_app_context()
        if hasattr(app, "shared_queue") and app.shared_queue:
            shutdown_message = SystemShutdownEvent()
            try:
                app.shared_queue.put(shutdown_message, block=False)
            except queue.Full:
                logger.warning("Message queue is full, shutdown request dropped")
                return _json_response({"ok": False, "error": "Message queue is full"}, status=503)
            logger.info("Shutdown signal sent to message queue.")
            return _json_response({"ok": True, "message": "Shutdown initiated"})

        logger.warning("Message queue not available, shutdown failed")
        return _json_response({"ok": False, "error": "Message queue not available"}, status=503)
    except Exception as e:
        logger.error(f"Shutdown handler error: {e}")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


def setup_routes(app: web.Application):
    app.router.add_get("/api/settings", get_settings_handler)
    app.router.add_post("/api/settings", save_settings_handler)
    app.router.add_post("/api/settings/reset", reset_settings_handler)
    app.router.add_get("/api/models", get_models_handler)
    app.router.add_get("/api/majsoul-mod-settings", get_majsoul_mod_settings_handler)
    app.router.add_post("/api/majsoul-mod-settings", save_majsoul_mod_settings_handler)
    app.router.add_post("/api/majsoul-mod-settings/reset", reset_majsoul_mod_settings_handler)
    app.router.add_post("/api/ingest", ingest_mjai_handler)
    app.router.add_post("/api/shutdown", shutdown_handler)
