import asyncio
import contextlib
import json
import logging
import os
import threading
import time

import pytest
from aiohttp import web

# 使用同步 API
from playwright.sync_api import Page, expect

# 配置日志
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

MOCK_SETTINGS = {
    "majsoul_url": "https://game.maj-soul.com/1/",
    "locale": "zh-CN",
    "connection": {"mode": "browser"},
}
TEST_PORT = 8765


# -----------------------------------------------------------------------------
# Mock Server (Threaded Wrapper, Async internals)
# -----------------------------------------------------------------------------


class ThreadedMockServer(threading.Thread):
    def __init__(self, port):
        super().__init__()
        self.port = port
        self.loop = asyncio.new_event_loop()
        self.app = web.Application()
        self.runner = None
        self.server_ready = threading.Event()
        self.stop_event = threading.Event()

        # Configure App
        self.app.router.add_get("/sse", self.sse_handler)
        self.app.router.add_get("/api/settings", self.settings_handler)
        self.app.router.add_options("/sse", self.cors_options)
        self.app.router.add_options("/api/settings", self.cors_options)
        self.app.middlewares.append(self.cors_middleware)

        self.scenarios = [
            # 1. 初始连接
            {"type": "system_event", "code": "client_connected"},
            {"type": "system_event", "code": "model_loaded_online"},
            {"type": "system_event", "code": "model_loaded_local"},
            # 2. 接入对局
            {"type": "system_event", "code": "game_connected"},
            {"type": "system_event", "code": "game_syncing"},
            # 3. 对局中异常：在线服务异常 -> 切换本地
            {"type": "system_event", "code": "fallback_used"},
            # 4. 对局中异常：重连与恢复
            {"type": "system_event", "code": "reconnecting"},
            {"type": "system_event", "code": "online_service_restored"},
            # 5. 对局中异常：推演/解析失败
            {"type": "system_event", "code": "riichi_simulation_failed"},
            {"type": "system_event", "code": "game_data_parse_failed"},
            {"type": "system_event", "code": "json_decode_error"},
            {"type": "system_event", "code": "state_tracker_error"},
            {"type": "system_event", "code": "bot_runtime_error"},
            # 6. 游戏断开和重连
            {"type": "system_event", "code": "game_disconnected"},
            {"type": "system_event", "code": "client_connected"},
            {"type": "system_event", "code": "return_lobby"},
            # 7. 其他系统错误 (模拟)
            {"type": "system_event", "code": "config_error"},
            {"type": "system_event", "code": "missing_resources"},
            {"type": "system_event", "code": "no_bot_loaded"},
            {"type": "system_event", "code": "model_load_failed"},
            {"type": "system_event", "code": "bot_switch_failed"},
            {"type": "system_event", "code": "service_disconnected"},
        ]

    def run(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._run_server())

    async def _run_server(self):
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "localhost", self.port)
        await site.start()

        self.server_ready.set()
        logger.info(f"Mock Server running on port {self.port}")

        # Wait until stop signal
        while not self.stop_event.is_set():
            await asyncio.sleep(0.5)

        await self.runner.cleanup()

    def stop(self):
        self.stop_event.set()
        self.join()

    # Handlers
    @staticmethod
    @web.middleware
    async def cors_middleware(request, handler):
        if request.method == "OPTIONS":
            return web.Response(
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                    "Access-Control-Allow-Headers": "*",
                }
            )
        response = await handler(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    async def cors_options(self, request):
        return web.Response()

    async def settings_handler(self, request):
        return web.json_response(MOCK_SETTINGS)

    async def sse_handler(self, request):
        headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
        response = web.StreamResponse(status=200, headers=headers)
        await response.prepare(request)

        # 初始 Ping (使用默认 message 事件，前端可能会忽略但能保持连接)
        await self._send_event(response, {"type": "ping", "data": "pong"})
        await asyncio.sleep(1)

        for step in self.scenarios:
            if self.stop_event.is_set():
                break
            await asyncio.sleep(1.5)
            # 包装为前端期望的格式: event="notification", data={"list": [step]}
            await self._send_notification(response, {"list": [step]})

        while not self.stop_event.is_set():
            await asyncio.sleep(5)
            await self._send_event(response, {"type": "ping"})

        return response

    async def _send_event(self, response, data):
        """发送普通消息 (event: message)"""
        with contextlib.suppress(Exception):
            msg = f"data: {json.dumps(data)}\n\n"
            await response.write(msg.encode("utf-8"))

    async def _send_notification(self, response, data):
        """发送通知事件 (event: notification)"""
        with contextlib.suppress(Exception):
            # 必须包含 event: notification 行
            msg = f"event: notification\ndata: {json.dumps(data)}\n\n"
            await response.write(msg.encode("utf-8"))


# -----------------------------------------------------------------------------
# Tests (Sync API)
# -----------------------------------------------------------------------------


@pytest.fixture(scope="module")
def mock_server():
    server = ThreadedMockServer(port=TEST_PORT)
    server.start()
    server.server_ready.wait(timeout=5)
    yield server
    server.stop()


@pytest.mark.e2e
@pytest.mark.skipif(os.environ.get("CI") == "true", reason="Skipping E2E tests in CI environment")
def test_notification_flow(page: Page, mock_server):
    """
    E2E Test using Playwright Sync API
    """
    frontend_url = "http://localhost:5173"
    mock_url = f"http://localhost:{TEST_PORT}"

    # Route requests to Mock Server
    def handle_route(route):
        url = route.request.url
        if "/api/settings" in url:
            route.continue_(url=f"{mock_url}/api/settings")
        elif "/sse" in url:
            # Preserve query parameters
            target = f"{mock_url}/sse"
            if "?" in url:
                target += "?" + url.split("?")[1]
            route.continue_(url=target)
        else:
            route.continue_()

    page.route("**/api/settings", handle_route)
    page.route("**/sse*", handle_route)

    try:
        page.goto(frontend_url)
    except Exception:
        pytest.fail("Frontend not running.")

    # 1. 初始连接
    expect(page.get_by_text("游戏已连接")).to_be_visible(timeout=10000)
    expect(page.get_by_text("已加载在线模型")).to_be_visible(timeout=10000)
    expect(page.get_by_text("已加载本地模型")).to_be_visible(timeout=10000)

    # 2. 接入对局
    expect(page.get_by_text("对局已连接，AI 已就绪")).to_be_visible(timeout=10000)
    expect(page.get_by_text("正在同步对局数据")).to_be_visible(timeout=10000)

    # 3. 对局中异常：在线服务异常 -> 切换本地
    expect(page.get_by_text("在线服务不可用")).to_be_visible(timeout=10000)

    # 4. 对局中异常：重连与恢复
    expect(page.get_by_text("正在重连")).to_be_visible(timeout=10000)
    expect(page.get_by_text("在线服务连接已恢复")).to_be_visible(timeout=10000)

    # 5. 对局中异常：推演/解析失败
    expect(page.get_by_text("立直模拟推演失败")).to_be_visible(timeout=10000)
    expect(page.get_by_text("游戏数据解析异常")).to_be_visible(timeout=10000)
    expect(page.get_by_text("JSON 数据解析失败")).to_be_visible(timeout=10000)
    expect(page.get_by_text("对局状态异常")).to_be_visible(timeout=10000)
    expect(page.get_by_text("AI 模型运行异常")).to_be_visible(timeout=10000)

    # 6. 游戏断开和重连
    expect(page.get_by_text("游戏连接中断")).to_be_visible(timeout=10000)
    expect(page.get_by_text("游戏已连接")).to_be_visible(timeout=10000)
    expect(page.get_by_text("已离开当前对局")).to_be_visible(timeout=10000)

    # 7. 其他系统错误
    expect(page.get_by_text("配置错误")).to_be_visible(timeout=10000)
    expect(page.get_by_text("缺少必要的系统资源")).to_be_visible(timeout=10000)
    expect(page.get_by_text("AI 模型未加载")).to_be_visible(timeout=10000)
    expect(page.get_by_text("AI 模型加载失败")).to_be_visible(timeout=10000)
    expect(page.get_by_text("AI 模型切换失败")).to_be_visible(timeout=10000)
    expect(page.get_by_text("服务连接已中断")).to_be_visible(timeout=10000)


if __name__ == "__main__":
    s = ThreadedMockServer(TEST_PORT)
    s.start()
    print("Server running. Press Ctr+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        s.stop()
