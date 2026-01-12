import queue
import threading
import traceback

from playwright.sync_api import Page, WebSocket, sync_playwright

from akagi_ng.bridge import MajsoulBridge
from akagi_ng.core.paths import get_playwright_data_dir
from akagi_ng.playwright_client.logger import logger
from akagi_ng.settings import local_settings

# 雀魂中每个流的消息都有 ID，每个流需要一个独立的 Bridge
activated_flows: list[str] = []  # 存储所有 flow.id
majsoul_bridges: dict[WebSocket, MajsoulBridge] = {}  # 存储 WebSocket -> MajsoulBridge 映射
mjai_messages: queue.Queue[dict] = queue.Queue()  # 存储所有消息


class PlaywrightController:
    """
    Playwright 浏览器实例控制器。
    在独立线程中运行，管理页面、处理命令队列、监听 WebSocket。
    """

    def __init__(self, url: str, frontend_url: str):
        """初始化控制器"""
        self.url = url
        self.frontend_url = frontend_url
        self.command_queue: queue.Queue[dict] = queue.Queue()
        self.running = False
        self.majsoul_page: Page | None = None
        self.frontend_page: Page | None = None
        self.bridge_lock = threading.Lock()

    def _on_web_socket(self, ws: WebSocket):
        """新 WebSocket 连接回调"""
        global majsoul_bridges
        logger.info("[WebSocket] Connection opened")
        logger.info(f"[WebSocket] Connection opened: {ws.url}")

        # 为新 WebSocket 创建并存储 Bridge
        majsoul_bridges[ws] = MajsoulBridge()

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
        global mjai_messages, majsoul_bridges
        direction = "<- Sent" if from_client else "-> Received"
        logger.trace(f"[WebSocket] {direction}: {payload}")

        bridge = majsoul_bridges.get(ws)
        if not bridge:
            logger.error(f"[WebSocket] Message received from untracked WebSocket: {ws.url}")
            return

        try:
            # 获取锁以确保线程安全解析
            with self.bridge_lock:
                msgs = bridge.parse(payload)

            if msgs is None:
                return

            # 将解析后的消息添加到共享队列
            for m in msgs:
                mjai_messages.put(m)
        except Exception:
            # with 语句会自动释放锁
            logger.error(f"[WebSocket] Error during message parsing: {traceback.format_exc()}")

    def _on_socket_close(self, ws: WebSocket):
        """WebSocket 关闭回调"""
        global majsoul_bridges
        if ws in majsoul_bridges:
            logger.info(f"[WebSocket] Connection closed: {ws.url}")
            # 清理对应的 Bridge
            game_ended = getattr(majsoul_bridges[ws], "game_ended", False)
            del majsoul_bridges[ws]
            # 通知主循环游戏连接已断开
            code = "return_lobby" if game_ended else "game_disconnected"
            mjai_messages.put({"type": "system_event", "code": code})
        else:
            logger.warning(f"[WebSocket] Untracked WebSocket connection closed: {ws.url}")

    def _process_commands(self):
        """命令处理主循环"""
        while True:
            try:
                # 等待命令，带超时以便检查停止事件
                command_data = self.command_queue.get_nowait()
                command = command_data.get("command")
                if command == "stop":
                    while not self.command_queue.empty():
                        self.command_queue.get_nowait()
                    break
                else:
                    logger.warning(f"Unknown command received: {command}")

            except queue.Empty:
                # 队列为空，继续循环检查停止事件

                # 如果前端页面存在，用它作为主要生命周期指示器
                if self.frontend_page:
                    if self.frontend_page.is_closed():
                        logger.info("Frontend page closed. Stopping...")
                        break
                    try:
                        self.frontend_page.wait_for_timeout(20)
                    except Exception:
                        # 等待失败，假定已关闭或出错
                        break
                # 如果前端页面未打开，回退到旧逻辑
                elif self.majsoul_page:
                    self.majsoul_page.wait_for_timeout(20)  # 使用较短的超时时间（毫秒）
                continue
            except Exception as e:
                logger.error(f"An error occurred in the command processing loop: {e}")

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

                # Listen for new pages created in the context (e.g., new tabs)
                # and automatically attach WebSocket listeners
                context.on("page", lambda new_page: new_page.on("websocket", self._on_web_socket))

                # 获取现有页面
                page = context.pages[0]
                self.majsoul_page = page

                # 为所有现有页面附加 WebSocket 监听器
                for existing_page in context.pages:
                    existing_page.on("websocket", self._on_web_socket)

                logger.info(f"Navigating to {self.url}...")
                page.goto(self.url)
                logger.info("Page loaded. Ready for commands.")
                try:
                    logger.info(f"Opening Akagi frontend: {self.frontend_url}")
                    frontend_page = context.new_page()
                    frontend_page.goto(self.frontend_url)
                    self.frontend_page = frontend_page
                except Exception as e:
                    logger.error(f"Failed to open Akagi frontend page: {e}")
                # 开始处理命令
                self._process_commands()

        except Exception as e:
            logger.error(f"A critical error occurred during Playwright startup or operation: {e}")
        finally:
            logger.info("Shutting down...")
            self.running = False
            logger.info("Controller Stopped.")

    def stop(self):
        """
        发送停止信号并清理资源。
        """
        if self.running:
            logger.info("Sending stop signal...")
            self.command_queue.put({"command": "stop"})
        else:
            logger.info("Controller already stopped.")
