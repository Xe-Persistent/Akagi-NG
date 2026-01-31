import asyncio
import json

from aiohttp import web

from akagi_ng.dataserver.logger import logger


def _format_sse_message(data: dict, event: str | None = None) -> bytes:
    msg = f"data: {json.dumps(data, ensure_ascii=False)}\n"
    if event:
        msg = f"event: {event}\n{msg}"
    return f"{msg}\n".encode()


async def _send_payload(client_id: str, response: web.StreamResponse, payload: bytes) -> bool:
    try:
        await response.write(payload)
        return True
    except ConnectionResetError:
        logger.warning(f"SSE connection reset for {client_id}")
        return False
    except Exception as exc:
        logger.error(f"Failed to send data to {client_id}: {exc}")
        return False


class SSEManager:
    """
    Manages SSE connections, broadcasting, and keep-alives.
    """

    def __init__(self):
        self.clients: dict[str, dict] = {}  # {clientId: {"response": StreamResponse, "request": Request}}
        self.latest_recommendations = None
        self.notification_history: list[dict] = []
        self.MAX_HISTORY = 10
        self.keep_alive_task = None
        self.loop = None  # 事件循环引用，由 DataServer 设置
        self.running = False

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    def start(self):
        self.running = True
        if self.loop:
            self.keep_alive_task = self.loop.create_task(self.keep_alive())

    def stop(self):
        self.running = False
        if self.keep_alive_task:
            self.keep_alive_task.cancel()

    async def _remove_client(self, client_id: str, expected_response: web.StreamResponse | None = None):
        client_data = self.clients.get(client_id)
        # 如果存储的响应与我们打算关闭的不匹配，则跳过移除以避免
        # 踢掉重用相同 client_id 的新连接
        if (
            expected_response is not None
            and client_data is not None
            and client_data.get("response") is not expected_response
        ):
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

    async def sse_handler(self, request: web.Request) -> web.StreamResponse:
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
        except Exception as exc:
            logger.warning(f"Failed to send initial SSE comment to {client_id}: {exc}")

        if self.latest_recommendations:
            await _send_payload(
                client_id, response, _format_sse_message(self.latest_recommendations, event="recommendations")
            )

        # 发送历史通知，确保客户端能看到启动过程中的所有状态
        for notification in self.notification_history:
            await _send_payload(client_id, response, _format_sse_message(notification, event="notification"))

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

    async def _broadcast_async(self, payload: bytes):
        if not self.clients:
            return

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
            for client_id, result in zip(client_order, results, strict=True):
                if result is False or isinstance(result, Exception):
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = self.clients.get(client_id, {}).get("response")

        for client_id in zombie_client_ids:
            await self._remove_client(client_id, expected_response=zombie_responses.get(client_id))

    def broadcast_event(self, event: str, data: dict):
        """
        Broadcast a named event to all clients.
        Update the corresponding cache based on event type.
        """
        if event == "recommendations":
            self.latest_recommendations = data
        elif event == "notification":
            self.notification_history.append(data)
            if len(self.notification_history) > self.MAX_HISTORY:
                self.notification_history.pop(0)

        if self.loop and self.running:
            payload = _format_sse_message(data, event)
            asyncio.run_coroutine_threadsafe(self._broadcast_async(payload), self.loop)

    async def keep_alive(self):
        while True:
            await asyncio.sleep(10)
            if not self.clients:
                continue
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
                except ConnectionResetError:
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = response
                except Exception as exc:
                    logger.warning(f"Keep-alive failed for {client_id}: {exc}")
                    zombie_client_ids.append(client_id)
                    zombie_responses[client_id] = response

            for client_id in zombie_client_ids:
                await self._remove_client(client_id, expected_response=zombie_responses.get(client_id))
