"""
Playwright Controller 基类模块。

提供通用的 Playwright 浏览器控制逻辑，子类只需提供平台特定配置。
"""

import queue
import threading
from abc import ABC, abstractmethod

from playwright.sync_api import Page, WebSocket, sync_playwright

from akagi_ng.bridge.base import BaseBridge
from akagi_ng.core.paths import get_playwright_data_dir
from akagi_ng.playwright_client.logger import logger
from akagi_ng.settings import local_settings


class BasePlaywrightController(ABC):
    """
    Playwright 浏览器实例控制器基类。

    在独立线程中运行，管理页面、处理命令队列、监听 WebSocket。
    子类需要实现 `create_bridge()` 和 `get_bridges_dict()` 方法。
    """

    def __init__(self, url: str, frontend_url: str, messages_queue: queue.Queue[dict]):
        """初始化控制器"""
        self.url = url
        self.frontend_url = frontend_url
        self.messages_queue = messages_queue
        self.command_queue: queue.Queue[dict] = queue.Queue()
        self.running = False
        self.game_page: Page | None = None
        self.frontend_page: Page | None = None
        self.bridge_lock = threading.Lock()

    @abstractmethod
    def create_bridge(self) -> BaseBridge:
        """创建平台特定的 Bridge 实例"""
        pass

    @abstractmethod
    def get_bridges_dict(self) -> dict[WebSocket, BaseBridge]:
        """获取 Bridge 字典的引用"""
        pass

    @abstractmethod
    def preprocess_payload(self, payload: str | bytes) -> bytes:
        """预处理 WebSocket payload（如类型转换）"""
        pass

    def _on_web_socket(self, ws: WebSocket):
        """新 WebSocket 连接回调"""
        bridges_dict = self.get_bridges_dict()
        logger.info(f"[WebSocket] Connection opened: {ws.url}")

        # 为新 WebSocket 创建并存储 Bridge
        bridges_dict[ws] = self.create_bridge()

        # 发送客户端连接成功通知
        self.messages_queue.put({"type": "system_event", "code": "client_connected"})

        # 设置消息和关闭事件监听器
        def handle_sent(payload: str | bytes):
            self._on_frame(ws, payload, from_client=True)

        def handle_received(payload: str | bytes):
            self._on_frame(ws, payload, from_client=False)

        def handle_close(_: WebSocket):
            self._on_socket_close(ws)

        ws.on("framesent", handle_sent)
        ws.on("framereceived", handle_received)
        ws.on("close", handle_close)

    def _on_frame(self, ws: WebSocket, payload: str | bytes, from_client: bool):
        """WebSocket 消息回调"""
        bridges_dict = self.get_bridges_dict()
        direction = "<- Sent" if from_client else "-> Received"
        logger.trace(f"[WebSocket] {direction}: {payload}")

        bridge = bridges_dict.get(ws)
        if not bridge:
            logger.error(f"[WebSocket] Message received from untracked WebSocket: {ws.url}")
            return

        try:
            # 获取锁以确保线程安全解析
            with self.bridge_lock:
                payload = self.preprocess_payload(payload)
                msgs = bridge.parse(payload)

            if msgs is None:
                return

            # 将解析后的消息添加到共享队列
            for m in msgs:
                self.messages_queue.put(m)
        except Exception as e:
            logger.error(f"[WebSocket] Error during message parsing: {e}")

    def _on_socket_close(self, ws: WebSocket):
        """WebSocket 关闭回调"""
        bridges_dict = self.get_bridges_dict()
        if ws in bridges_dict:
            logger.info(f"[WebSocket] Connection closed: {ws.url}")
            # 清理对应的 Bridge
            game_ended = getattr(bridges_dict[ws], "game_ended", False)
            del bridges_dict[ws]
            # 通知主循环游戏连接已断开
            code = "return_lobby" if game_ended else "game_disconnected"
            self.messages_queue.put({"type": "system_event", "code": code})
        else:
            logger.warning(f"[WebSocket] Untracked WebSocket connection closed: {ws.url}")

    def _handle_command(self, command: str, command_data: dict) -> bool:
        """处理单个命令。返回 True 表示应停止。"""
        if command == "stop":
            while not self.command_queue.empty():
                self.command_queue.get_nowait()
            return True

        logger.warning(f"Unknown command: {command}")
        return False

    def _process_commands(self):
        """命令处理主循环"""
        while True:
            try:
                command_data = self.command_queue.get_nowait()
                if self._handle_command(command_data.get("command"), command_data):
                    break
            except queue.Empty:
                # 队列为空，检查生命周期
                if self.frontend_page:
                    if self.frontend_page.is_closed():
                        logger.info("Frontend page closed. Stopping...")
                        break
                    try:
                        self.frontend_page.wait_for_timeout(20)
                    except Exception:
                        break
                elif self.game_page:
                    if self.game_page.is_closed():
                        break
                    self.game_page.wait_for_timeout(20)
                continue
            except Exception as e:
                logger.error(f"Error in command loop: {e}")

    def start(self):
        """
        启动 Playwright 实例，打开浏览器，开始命令处理循环。
        此方法应作为线程目标。
        """
        logger.info("Controller Starting...")
        self.running = True

        try:
            with sync_playwright() as p:
                # 准备启动参数
                launch_args = ["--disable-blink-features=AutomationControlled"]
                window_size = local_settings.browser.window_size
                if window_size == "maximized":
                    launch_args.append("--start-maximized")
                elif window_size:
                    launch_args.append(f"--window-size={window_size}")

                user_data_dir = get_playwright_data_dir()
                context = p.chromium.launch_persistent_context(
                    user_data_dir=user_data_dir,
                    headless=local_settings.browser.headless,
                    locale=local_settings.locale,
                    no_viewport=True,
                    ignore_default_args=["--enable-automation"],
                    args=launch_args,
                )

                # 监听新页面并自动附加 WebSocket 监听器
                context.on("page", lambda new_page: new_page.on("websocket", self._on_web_socket))

                # 获取现有页面
                page = context.pages[0]
                self.game_page = page

                # 为所有现有页面附加 WebSocket 监听器
                for existing_page in context.pages:
                    existing_page.on("websocket", self._on_web_socket)

                logger.info(f"Navigating to {self.url}...")
                page.goto(self.url)
                logger.info("Page loaded. Ready for commands.")

                # 打开前端页面
                try:
                    logger.info(f"Opening Akagi frontend: {self.frontend_url}")
                    frontend_page = context.new_page()
                    frontend_page.goto(self.frontend_url)
                    self.frontend_page = frontend_page
                except Exception as e:
                    logger.error(f"Failed to open Akagi frontend: {e}")

                # 开始处理命令
                self._process_commands()

        except Exception as e:
            logger.error(f"Critical error in Controller: {e}")
        finally:
            logger.info("Controller Stopped.")
            self.running = False

    def stop(self):
        """发送停止信号并清理资源。"""
        if self.running:
            logger.info("Sending stop signal...")
            self.command_queue.put({"command": "stop"})
        else:
            logger.info("Controller already stopped.")
