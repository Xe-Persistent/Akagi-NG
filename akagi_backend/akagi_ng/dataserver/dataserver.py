import asyncio
import contextlib
import threading

from aiohttp import web

from akagi_ng.dataserver.api import cors_middleware, setup_routes
from akagi_ng.dataserver.logger import logger
from akagi_ng.dataserver.sse import SSEManager
from akagi_ng.settings import local_settings


class DataServer(threading.Thread):
    def __init__(self, host: str | None = None, external_port: int | None = None):
        super().__init__()
        self.host = host if host is not None else local_settings.server.host
        self.daemon = True
        self.external_port = external_port if external_port is not None else local_settings.server.port
        self.sse_manager = SSEManager()
        self.loop = None
        self.runner = None
        self.running = False

    def broadcast_event(self, event: str, data: dict):
        """代理到 SSEManager"""
        self.sse_manager.broadcast_event(event, data)

    def send_recommendations(self, recommendations_data: dict):
        """广播推荐数据"""
        # 过滤空推荐以避免干扰
        if not recommendations_data.get("recommendations"):
            return
        self.broadcast_event("recommendations", recommendations_data)

    def update_system_error(self, error_code: str, details: str = ""):
        self.send_notifications([{"code": error_code, "msg": details}])

    def send_notifications(self, notifications: list[dict]):
        """
        使用 'notification' 事件广播通知列表。
        """
        if not notifications:
            return
        data = {"list": notifications}
        self.broadcast_event("notification", data)

    def stop(self):
        if self.running and self.loop and self.loop.is_running():
            self.loop.call_soon_threadsafe(self.loop.stop)
            logger.info("DataServer stop signal sent.")
        self.running = False
        if self.sse_manager:
            self.sse_manager.stop()
        if self.is_alive():
            self.join(timeout=2.0)

    def run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)

        # 初始化 SSE 循环
        self.sse_manager.set_loop(self.loop)
        self.sse_manager.start()

        try:
            app = web.Application(middlewares=[cors_middleware])

            # --- API / SSE ---
            app.router.add_get("/sse", self.sse_manager.sse_handler)
            setup_routes(app)

            self.runner = web.AppRunner(app)
            self.loop.run_until_complete(self.runner.setup())

            site = web.TCPSite(self.runner, self.host, self.external_port)
            self.loop.run_until_complete(site.start())

            logger.info(f"DataServer listening on {self.host}:{self.external_port}")
            self.running = True

            # Keep alive 任务由 SSEManager 管理，但需要 run_forever
            self.loop.run_forever()
        except Exception as e:
            logger.error(f"DataServer startup/runtime error: {e}")
            self.running = False
        finally:
            if self.runner:
                with contextlib.suppress(Exception):
                    self.loop.run_until_complete(self.runner.cleanup())

            # 取消所有剩余任务
            with contextlib.suppress(Exception):
                pending = asyncio.all_tasks(self.loop)
                if pending:
                    for task in pending:
                        task.cancel()
                    self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))

            with contextlib.suppress(Exception):
                self.loop.close()

            logger.info("DataServer event loop stopped.")
