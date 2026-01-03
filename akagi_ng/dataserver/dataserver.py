import asyncio
import json
from threading import Thread

from aiohttp import web

from core.context import get_frontend_dir
from settings import get_settings_dict, verify_settings, local_settings, get_default_settings_dict
from .logger import logger


def _format_sse_message(data: dict) -> bytes:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


async def _send_payload(client_id: str, response: web.StreamResponse, payload: bytes) -> bool:
    try:
        await response.write(payload)
        await response.drain()
        return True
    except ConnectionResetError:
        logger.warning(f"SSE connection reset for {client_id}")
        return False
    except Exception as exc:
        logger.error(f"Failed to send data to {client_id}: {exc}")
        return False


class DataServer(Thread):
    def __init__(self, external_port=None):
        super().__init__()
        self.daemon = True
        self.external_port = external_port if external_port else local_settings.server.port
        self.clients: dict[str, dict] = {}  # {clientId: {"response": StreamResponse, "request": Request}}
        self.latest_data = None
        self.loop = None
        self.runner = None
        self.running = False
        self.keep_alive_task = None
        self.frontend_dist_dir = get_frontend_dir() / "dist"

    async def _remove_client(self, client_id: str, expected_response=None):
        client_data = self.clients.get(client_id)
        # If the stored response does not match the one we intend to close, skip removal to avoid
        # kicking out a fresh connection that reused the same client_id.
        if expected_response is not None and client_data is not None:
            if client_data.get("response") is not expected_response:
                return

        client_data = self.clients.pop(client_id, None)
        if not client_data:
            return

        response = client_data.get("response")
        try:
            if response:
                await response.write_eof()
        except ConnectionResetError:
            logger.debug(f"Client {client_id} already closed connection.")
        except Exception as exc:
            logger.warning(f"Error while closing connection for {client_id}: {exc}")

        logger.info(f"SSE client {client_id} disconnected.")

    async def keep_alive(self):
        while True:
            await asyncio.sleep(10)
            if not self.clients:
                continue

            logger.debug(f"Running keep-alive for {len(self.clients)} clients")
            zombie_client_ids = []
            zombie_responses = {}
            keepalive_payload = b": keep-alive\n\n"

            for client_id, client_data in list(self.clients.items()):
                response = client_data.get("response")
                request = client_data.get("request")

                if not request or not request.transport or request.transport.is_closing():
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = response
                    continue

                try:
                    await response.write(keepalive_payload)
                    await response.drain()
                except ConnectionResetError:
                    logger.warning(f"Connection reset for {client_id}, marking as zombie.")
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = response
                except Exception as exc:
                    logger.warning(f"Keep-alive failed for {client_id}: {exc}")
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = response

            for client_id in zombie_client_ids:
                await self._remove_client(client_id, expected_response=zombie_responses.get(client_id))

            logger.debug(f"Keep-alive check finished. {len(zombie_client_ids)} zombie clients removed.")

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        try:
            app = web.Application()

            # --- API / SSE ---
            app.router.add_get("/sse", self.sse_handler)
            app.router.add_route("OPTIONS", "/api/settings", self._cors_preflight)
            app.router.add_get("/api/settings", self.get_settings_handler)
            app.router.add_post("/api/settings", self.save_settings_handler)
            app.router.add_post("/api/settings/reset", self.reset_settings_handler)

            # --- Static frontend ---
            if self.frontend_dist_dir.exists():
                assets_dir = self.frontend_dist_dir / "assets"
                resources_dir = self.frontend_dist_dir / "Resources"

                if assets_dir.exists():
                    app.router.add_static("/assets/", assets_dir, show_index=False)

                if resources_dir.exists():
                    app.router.add_static("/Resources/", resources_dir, show_index=False)

                for p in self.frontend_dist_dir.iterdir():
                    if not p.is_file():
                        continue
                    if p.name == "index.html":
                        continue

                    async def _serve_file(request: web.Request, _path=p) -> web.Response:
                        return web.FileResponse(_path)

                    app.router.add_get(f"/{p.name}", _serve_file)

                async def _serve_index(_request: web.Request) -> web.Response:
                    return web.FileResponse(self.frontend_dist_dir / "index.html")

                # SPA entry + fallback
                app.router.add_get("/", _serve_index)
                app.router.add_get("/{tail:.*}", _serve_index)

                logger.info(f"Serving frontend from: {self.frontend_dist_dir}")
            else:
                logger.warning(
                    f"Frontend dist not found at {self.frontend_dist_dir}. "
                    f"Run `npm run build` in frontend/akagi_frontend first."
                )

            self.runner = web.AppRunner(app)
            self.loop.run_until_complete(self.runner.setup())

            site = web.TCPSite(self.runner, local_settings.server.host, self.external_port)
            self.loop.run_until_complete(site.start())

            logger.info(f"DataServer listening on {local_settings.server.host}:{self.external_port}")
            self.running = True
            self.keep_alive_task = self.loop.create_task(self.keep_alive())
            self.loop.run_forever()
        finally:
            if self.keep_alive_task:
                self.keep_alive_task.cancel()
            if self.runner:
                self.loop.run_until_complete(self.runner.cleanup())
            logger.info("DataServer event loop stopped.")

    async def _cors_preflight(self, _request: web.Request) -> web.Response:
        return web.Response(
            status=204,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        )

    async def get_settings_handler(self, _request: web.Request) -> web.Response:
        data = get_settings_dict()
        return web.json_response(
            {"ok": True, "data": data},
            headers={"Access-Control-Allow-Origin": "*"},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    async def save_settings_handler(self, request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "Invalid JSON"},
                status=400,
                headers={"Access-Control-Allow-Origin": "*"},
            )

        if not isinstance(payload, dict):
            return web.json_response(
                {"ok": False, "error": "Settings payload must be a JSON object"},
                status=400,
                headers={"Access-Control-Allow-Origin": "*"},
            )

        if not verify_settings(payload):
            return web.json_response(
                {"ok": False, "error": "Settings validation failed (schema mismatch)"},
                status=400,
                headers={"Access-Control-Allow-Origin": "*"},
            )

        local_settings.update(payload)
        local_settings.save()
        return web.json_response(
            {"ok": True, "restartRequired": True},
            headers={"Access-Control-Allow-Origin": "*"},
        )

    async def reset_settings_handler(self, _request: web.Request) -> web.Response:
        default_settings = get_default_settings_dict()
        local_settings.update(default_settings)
        local_settings.save()

        return web.json_response(
            {"ok": True, "data": default_settings, "restartRequired": True},
            headers={"Access-Control-Allow-Origin": "*"},
            dumps=lambda obj: json.dumps(obj, ensure_ascii=False),
        )

    def stop(self):
        if self.running and self.loop and self.loop.is_running():
            logger.info("Stopping DataServer...")
            self.loop.call_soon_threadsafe(self.loop.stop)
            logger.info("DataServer stop signal sent.")
        self.running = False

    async def _update_data_async(self, data):
        self.latest_data = data
        if not self.clients:
            return

        payload = _format_sse_message(data)
        logger.debug(f"Broadcasting to {len(self.clients)} clients: {json.dumps(data)}")

        zombie_client_ids = []
        zombie_responses = {}
        tasks = []
        client_order = []

        for client_id, client_data in list(self.clients.items()):
            request = client_data.get("request")
            response = client_data.get("response")
            if not request or not request.transport or request.transport.is_closing():
                zombie_client_ids.append(client_id)
                zombie_responses[client_id] = response
                continue

            client_order.append(client_id)
            tasks.append(_send_payload(client_id, response, payload))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for client_id, result in zip(client_order, results):
                if result is False or isinstance(result, Exception):
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = self.clients.get(client_id, {}).get("response")

        for client_id in zombie_client_ids:
            await self._remove_client(client_id, expected_response=zombie_responses.get(client_id))

    def update_data(self, data):
        if self.loop and self.running:
            asyncio.run_coroutine_threadsafe(self._update_data_async(data), self.loop)

    async def sse_handler(self, request):
        client_id = request.query.get("clientId")
        if not client_id:
            logger.warning("Client connected without clientId, rejecting.")
            return web.HTTPBadRequest(text="clientId is required")

        headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }

        response = web.StreamResponse(status=200, headers=headers)
        await response.prepare(request)

        if client_id in self.clients:
            logger.warning(f"Client {client_id} already connected. Closing old connection.")
            await self._remove_client(client_id, expected_response=self.clients[client_id].get("response"))

        self.clients[client_id] = {"response": response, "request": request}
        logger.info(f"SSE client {client_id} connected from {request.remote}")

        try:
            await response.write(b": connected\n\n")
            await response.drain()
        except Exception as exc:
            logger.warning(f"Failed to send initial SSE comment to {client_id}: {exc}")

        if self.latest_data:
            await _send_payload(client_id, response, _format_sse_message(self.latest_data))

        try:
            while True:
                await asyncio.sleep(1)
                transport = request.transport
                if not transport or transport.is_closing():
                    logger.info(f"SSE client {client_id} closed the connection.")
                    break
        except asyncio.CancelledError:
            logger.debug(f"SSE handler for {client_id} cancelled.")
        finally:
            await self._remove_client(client_id, expected_response=response)

        return response
