import json
import mimetypes
import os
import signal
import threading
import time

from aiohttp import web

from akagi_ng.core.logging import configure_logging
from akagi_ng.dataserver.logger import logger
from akagi_ng.settings import get_default_settings_dict, get_settings_dict, local_settings, verify_settings

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

# Winodws 下部分系统 mimetype 默认为 text/plain，导致 module 脚本无法加载
# 强制指定 js 文件的 mimetype
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Add CORS headers to all responses."""
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=CORS_HEADERS)
    response = await handler(request)
    response.headers.update({"Access-Control-Allow-Origin": "*"})
    return response


def _json_response(data, status: int = 200) -> web.Response:
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
        payload.get("server") != old_settings.get("server")
        or payload.get("browser") != old_settings.get("browser")
        or payload.get("mitm") != old_settings.get("mitm")
        or payload.get("model") != old_settings.get("model")
        or payload.get("model_config", {}).get("device") != old_settings.get("model_config", {}).get("device")
    ):
        restart_required = True

    return _json_response({"ok": True, "restartRequired": restart_required})


async def reset_settings_handler(_request: web.Request) -> web.Response:
    default_settings = get_default_settings_dict()
    local_settings.update(default_settings)
    local_settings.save()
    return _json_response({"ok": True, "data": default_settings, "restartRequired": True})


async def handle_shutdown(_request: web.Request) -> web.Response:
    def _kill():
        time.sleep(1)  # Give time to send response
        logger.info("Shutdown requested via API. Sending SIGINT...")
        os.kill(os.getpid(), signal.SIGINT)

    threading.Thread(target=_kill).start()
    return web.json_response({"ok": True, "message": "Shutting down..."})


def setup_routes(app: web.Application):
    app.router.add_get("/api/settings", get_settings_handler)
    app.router.add_post("/api/settings", save_settings_handler)
    app.router.add_post("/api/settings/reset", reset_settings_handler)
    app.router.add_post("/api/shutdown", handle_shutdown)


def _serve_with_gzip(file_path, accept_encoding: str) -> web.StreamResponse:
    """Serve a file with gzip fallback if available and accepted."""
    gz_path = file_path.with_name(file_path.name + ".gz")

    if "gzip" in accept_encoding and gz_path.exists():
        response = web.FileResponse(gz_path)
        response.headers["Content-Encoding"] = "gzip"
        ct, _ = mimetypes.guess_type(file_path.name)
        if ct:
            response.headers["Content-Type"] = ct
        return response

    return web.FileResponse(file_path)


def _setup_assets_route(app: web.Application, assets_dir):
    """设置 assets 静态资源路由"""
    if not assets_dir.exists():
        return

    async def _serve_asset(request: web.Request) -> web.StreamResponse:
        tail = request.match_info.get("tail", "")
        if not tail:
            return web.HTTPNotFound()

        # Secure path handling to prevent traversal
        try:
            file_path = (assets_dir / tail).resolve()
            if not str(file_path).startswith(str(assets_dir.resolve())):
                return web.HTTPForbidden()
        except Exception:
            return web.HTTPNotFound()

        if not file_path.exists() or not file_path.is_file():
            return web.HTTPNotFound()

        return _serve_with_gzip(file_path, request.headers.get("Accept-Encoding", ""))

    app.router.add_get("/assets/{tail:.*}", _serve_asset)


def _setup_resources_route(app: web.Application, resources_dir):
    """设置 Resources 静态资源路由"""
    if resources_dir.exists():
        app.router.add_static("/Resources/", resources_dir, show_index=False)


def _setup_root_files_routes(app: web.Application, frontend_dist_dir):
    """设置根目录文件路由（除了 index.html）"""
    for p in frontend_dist_dir.iterdir():
        if not p.is_file() or p.name == "index.html":
            continue

        async def _serve_file(request: web.Request, _path=p) -> web.StreamResponse:
            return _serve_with_gzip(_path, request.headers.get("Accept-Encoding", ""))

        app.router.add_get(f"/{p.name}", _serve_file)


def _setup_spa_routes(app: web.Application, frontend_dist_dir):
    """设置 SPA 入口和回退路由"""

    async def _serve_index(_request: web.Request) -> web.StreamResponse:
        return web.FileResponse(frontend_dist_dir / "index.html")

    # SPA entry + fallback
    app.router.add_get("/", _serve_index)
    app.router.add_get("/{tail:.*}", _serve_index)


def setup_static_routes(app: web.Application, frontend_dist_dir):
    if not frontend_dist_dir.exists():
        logger.warning(
            f"Frontend dist not found at {frontend_dist_dir}. Run `npm run build` in frontend/akagi_frontend first."
        )
        return

    assets_dir = frontend_dist_dir / "assets"
    resources_dir = frontend_dist_dir / "Resources"

    _setup_assets_route(app, assets_dir)
    _setup_resources_route(app, resources_dir)
    _setup_root_files_routes(app, frontend_dist_dir)
    _setup_spa_routes(app, frontend_dist_dir)

    logger.info(f"Serving frontend from: {frontend_dist_dir}")
