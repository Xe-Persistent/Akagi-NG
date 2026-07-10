import asyncio
import json
import queue
from collections.abc import Callable

from aiohttp import web

from akagi_ng.core.context import get_app_context
from akagi_ng.core.logging import configure_logging
from akagi_ng.core.paths import ensure_dir, get_assets_dir, get_models_dir
from akagi_ng.dataserver.logger import logger
from akagi_ng.mjai_bot.cloud_api import AkagiApiClient, CloudApiError
from akagi_ng.mjai_bot.engine import clear_resource_cache
from akagi_ng.schema.types import (
    DebuggerDetachedMessage,
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

# CORS 响应头配置
# 桌面端仅允许本机来源访问
CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def _is_allowed_origin(origin: str | None) -> bool:
    """检查来源是否为 localhost/127.0.0.1。"""
    if not origin:
        return True  # 允许无 Origin 的本地请求（如 EventSource）
    return "localhost" in origin or "127.0.0.1" in origin


@web.middleware
async def cors_middleware(request: web.Request, handler: Callable[[web.Request], web.StreamResponse]) -> web.Response:
    """为响应添加 CORS 头，仅允许本机来源。"""
    origin = request.headers.get("Origin")

    # 仅允许 localhost/127.0.0.1 或无 Origin 的本地请求
    if not _is_allowed_origin(origin):
        logger.warning(f"Blocked CORS request from unauthorized origin: {origin}")
        return web.Response(status=403, text="Forbidden: Invalid origin")

    # 设置允许来源（有 Origin 时回显，否则使用 *）
    allow_origin = origin if origin else "*"

    if request.method == "OPTIONS":
        headers = dict(CORS_HEADERS)
        headers["Access-Control-Allow-Origin"] = allow_origin
        return web.Response(status=204, headers=headers)

    response = await handler(request)
    response.headers.update({"Access-Control-Allow-Origin": allow_origin})
    return response


def _json_response(data: dict, status: int = 200) -> web.Response:
    """构造 ensure_ascii=False 的 JSON 响应。"""
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

    match payload:
        case dict():
            pass
        case _:
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
            configure_logging(new_level)
            logger.info(f"Log level changed to {new_level}, updating...")

        if (
            payload.get("platform") != old_settings.get("platform")
            or payload.get("majsoul_server") != old_settings.get("majsoul_server")
            or payload.get("mitm") != old_settings.get("mitm")
            or payload.get("server") != old_settings.get("server")
            or payload.get("ot") != old_settings.get("ot")
            or payload.get("model_config", {}).get("model_4p") != old_settings.get("model_config", {}).get("model_4p")
            or payload.get("model_config", {}).get("model_3p") != old_settings.get("model_config", {}).get("model_3p")
        ):
            restart_required = True

        clear_resource_cache()
        logger.info("Resource cache cleared due to settings update.")
        return _json_response({"ok": True, "data": get_settings_dict(), "restartRequired": restart_required})
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


async def _cloud_payload(request: web.Request) -> dict | web.Response:
    try:
        payload = await request.json()
    except Exception:
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)
    if not isinstance(payload, dict):
        return _json_response({"ok": False, "error": "Payload must be a JSON object"}, status=400)
    return payload


def _cloud_client(payload: dict) -> AkagiApiClient:
    base_url = str(payload.get("base_url", ""))
    key = str(payload.get("key", ""))
    if not base_url.strip() or not key.strip():
        raise CloudApiError("API base URL and key are required")
    return AkagiApiClient(base_url, key)


async def cloud_health_handler(request: web.Request) -> web.Response:
    payload = await _cloud_payload(request)
    if isinstance(payload, web.Response):
        return payload
    try:
        base_url = str(payload.get("base_url", ""))
        data = await asyncio.to_thread(AkagiApiClient.health, base_url)
        return _json_response({"ok": True, "data": data})
    except Exception as exc:
        logger.warning(f"Cloud API health check failed: {exc}")
        return _json_response({"ok": False, "error": str(exc)}, status=502)


async def cloud_key_status_handler(request: web.Request) -> web.Response:
    payload = await _cloud_payload(request)
    if isinstance(payload, web.Response):
        return payload
    try:
        client = _cloud_client(payload)
        data = await asyncio.to_thread(client.key_status)
        return _json_response({"ok": True, "data": data})
    except Exception as exc:
        logger.warning(f"Cloud API key check failed: {exc}")
        return _json_response({"ok": False, "error": str(exc)}, status=502)


async def cloud_models_handler(request: web.Request) -> web.Response:
    payload = await _cloud_payload(request)
    if isinstance(payload, web.Response):
        return payload
    try:
        client = _cloud_client(payload)
        data = await asyncio.to_thread(client.models)
        return _json_response({"ok": True, "data": data})
    except Exception as exc:
        logger.warning(f"Cloud API model query failed: {exc}")
        return _json_response({"ok": False, "error": str(exc)}, status=502)


async def cloud_redeem_handler(request: web.Request) -> web.Response:
    payload = await _cloud_payload(request)
    if isinstance(payload, web.Response):
        return payload
    try:
        code = str(payload.get("code", "")).strip()
        if not code:
            return _json_response({"ok": False, "error": "Redeem code is required"}, status=400)
        data = await asyncio.to_thread(
            AkagiApiClient.redeem,
            str(payload.get("base_url", "")),
            code,
            str(payload.get("email", "")) or None,
            str(payload.get("renew_key", "")) or None,
        )
        return _json_response({"ok": True, "data": data})
    except Exception as exc:
        logger.warning(f"Cloud API redeem failed: {exc}")
        return _json_response({"ok": False, "error": str(exc)}, status=502)


async def update_protocol_handler(request: web.Request) -> web.Response:
    """接收前端下载的 liqi.json 并保存到本地。"""
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Protocol update JSON error: {e}")
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    data = payload.get("data")
    if not data:
        return _json_response({"ok": False, "error": "Missing 'data' field"}, status=400)

    try:
        json_obj = json.loads(data)

        assets_dir = get_assets_dir()
        ensure_dir(assets_dir)
        liqi_path = assets_dir / "liqi.json"

        liqi_path.write_text(json.dumps(json_obj, indent=2, ensure_ascii=False), encoding="utf-8")

        # 热重载：收集所有活跃的 MajsoulBridge 实例并重置 proto
        from akagi_ng.bridge.majsoul.bridge import MajsoulBridge

        app = get_app_context()
        bridges: list[MajsoulBridge] = []

        if app.electron_client and app.electron_client.bridge:
            bridge = app.electron_client.bridge
            if isinstance(bridge, MajsoulBridge):
                bridges.append(bridge)

        if app.mitm_client and app.mitm_client.addon:
            bridges.extend(b for b in app.mitm_client.addon.bridges.values() if isinstance(b, MajsoulBridge))

        for bridge in bridges:
            bridge.liqi_proto = bridge.liqi_proto.__class__()

        if bridges:
            logger.info(f"Hot-reloaded liqi proto in {len(bridges)} active bridge(s).")

        logger.info(f"Successfully updated liqi.json at {liqi_path}")
        return _json_response({"ok": True})

    except json.JSONDecodeError:
        logger.warning("Received invalid JSON for liqi.json")
        return _json_response({"ok": False, "error": "Invalid JSON in liqi data"}, status=400)
    except OSError as e:
        logger.error(f"File system error updating liqi.json: {e}")
        return _json_response({"ok": False, "error": f"File system error: {e}"}, status=500)


async def ingest_mjai_handler(request: web.Request) -> web.Response:
    """接收 Electron 发送的 MJAI 消息"""
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Ingest JSON error: {e}")
        return _json_response({"ok": False, "error": "Invalid JSON"}, status=400)

    msg = None
    try:
        match payload:
            case {"type": "websocket_created", "url": url}:
                msg = WebSocketCreatedMessage(url=url)
            case {"type": "websocket_closed"}:
                msg = WebSocketClosedMessage()
            case {"type": "websocket", "direction": direction, "data": data}:
                msg = WebSocketFrameMessage(direction=direction, data=data, opcode=payload.get("opcode"))
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
            app.electron_client.push_message(msg)
            return _json_response({"ok": True})

        logger.warning("ElectronClient is not active")
        return _json_response({"ok": False, "error": "ElectronClient not active"}, status=503)
    except Exception as e:
        logger.error(f"Ingest handler error: {e}")
        return _json_response({"ok": False, "error": "Internal server error"}, status=500)


async def shutdown_handler(_request: web.Request) -> web.Response:
    """触发后端关闭

    通过共享消息队列发送关闭信号，由主循环统一处理。
    """
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
    app.router.add_post("/api/cloud/health", cloud_health_handler)
    app.router.add_post("/api/cloud/key-status", cloud_key_status_handler)
    app.router.add_post("/api/cloud/models", cloud_models_handler)
    app.router.add_post("/api/cloud/redeem", cloud_redeem_handler)
    app.router.add_post("/api/ingest", ingest_mjai_handler)
    app.router.add_post("/api/protocol/update", update_protocol_handler)
    app.router.add_post("/api/shutdown", shutdown_handler)
