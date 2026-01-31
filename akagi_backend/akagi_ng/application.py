from __future__ import annotations

import contextlib
import queue
import signal
import threading

from akagi_ng.core import AppContext, NotificationHandler, get_app_context, set_app_context
from akagi_ng.core.constants import ServerConstants
from akagi_ng.core.logging import configure_logging, logger
from akagi_ng.dataserver import DataServer
from akagi_ng.dataserver.adapter import build_dataserver_payload
from akagi_ng.mitm_client import MitmClient
from akagi_ng.mjai_bot import Controller, StateTrackerBot
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


class AkagiApp:
    def __init__(self):
        self._stop_event = threading.Event()
        self.ds: DataServer | None = None
        self.frontend_url = ""
        self.message_queue: queue.Queue[dict] = queue.Queue(maxsize=ServerConstants.MITM_MESSAGE_QUEUE_MAXSIZE)

    def initialize(self):
        import importlib

        from akagi_ng import AKAGI_VERSION
        from akagi_ng.electron_client import create_electron_client

        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")

        settings = loaded_settings
        configure_logging(settings.log_level)

        # Start DataServer
        host, port = settings.server.host, settings.server.port
        self.ds = DataServer(host=host, external_port=port)

        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        # Load MJAI Bot components
        mjai_bot, mjai_controller = None, None
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
            from akagi_ng.mjai_bot import Controller, StateTrackerBot

            mjai_bot, mjai_controller = StateTrackerBot(), Controller()
            logger.info("Bot components loaded successfully.")
        except ImportError as e:
            logger.error(f"Failed to load bot components or native library: {e}")

        app_context = AppContext(
            settings=settings,
            controller=mjai_controller,
            bot=mjai_bot,
            mitm_client=MitmClient(shared_queue=self.message_queue),
            electron_client=create_electron_client(settings.platform, shared_queue=self.message_queue),
        )

        set_app_context(app_context)

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        app = get_app_context()
        if app.settings.mitm.enabled and app.mitm_client:
            app.mitm_client.start()

        # Always start Electron client if available, so we can listen to API inputs
        if app.electron_client:
            app.electron_client.start()

        self._setup_signals()
        logger.info("Akagi backend loop started.")

    def _setup_signals(self):
        signal.signal(signal.SIGINT, lambda *_: self.stop())
        with contextlib.suppress(Exception):
            signal.signal(signal.SIGTERM, lambda *_: self.stop())

    def stop(self):
        self._stop_event.set()

    def _process_message_batch(
        self, mjai_msgs: list[dict], bot: StateTrackerBot | None, controller: Controller | None
    ) -> tuple[list[dict], list[dict]]:
        """
        Process a batch of MJAI messages.

        CRITICAL: Controller reacts BEFORE Bot updates state.
        Controller decides actions based on current state; if Bot updated first,
        Controller would act on "future" state instead of responding to current event.
        """
        mjai_responses: list[dict] = []
        batch_notifications: list[dict] = []

        for msg in mjai_msgs:
            try:
                # 1. 从消息本身提取通知 (例如 system_event)
                if n := NotificationHandler.from_message(msg):
                    batch_notifications.append(n)
                    if msg.get("type") == "system_event":
                        continue

                # 2. Controller 响应消息
                if controller and (resp := controller.react(msg)):
                    mjai_responses.append(resp)
                    # 立即采集 Controller 产生的标志 (如模型加载)
                    flags = getattr(controller, "notification_flags", {})
                    if flags:
                        batch_notifications.extend(NotificationHandler.from_flags(flags))

                # 3. Bot 更新状态
                if bot:
                    bot.react(msg)
                    # 立即采集 Bot 产生的标志
                    flags = getattr(bot, "notification_flags", {})
                    if flags:
                        batch_notifications.extend(NotificationHandler.from_flags(flags))

            except (ValueError, KeyError, TypeError) as e:
                logger.error(f"Invalid MJAI message format: {msg}, error: {e}")
            except Exception:
                logger.exception(f"Unexpected error processing MJAI message: {msg}")

        return mjai_responses, batch_notifications

    def _get_next_message(self, timeout: float = 0.1) -> dict | None:
        """
        Get the next message from the event queue (blocking with timeout).
        Returns None if timeout expires or queue is empty.

        This is the event-driven INPUT phase replacing polling.
        """
        try:
            return self.message_queue.get(block=True, timeout=timeout)
        except queue.Empty:
            return None

    def _process_events(
        self, mjai_msgs: list[dict], bot: StateTrackerBot | None, controller: Controller | None
    ) -> dict:
        """
        Process the batch of MJAI messages.
        This is the PROCESS phase of the Reactor pattern.

        Returns a result dict containing:
            - mjai_responses: List of responses from controller
            - notifications: List of notifications to send
        """
        mjai_responses, batch_notifications = self._process_message_batch(mjai_msgs, bot, controller)

        return {
            "mjai_responses": mjai_responses,
            "batch_notifications": batch_notifications,
        }

    def _emit_outputs(self, result: dict, bot: StateTrackerBot | None, controller: Controller | None):
        """
        Send processed results to the DataServer.
        This is the OUTPUT phase of the Reactor pattern.
        """
        mjai_responses = result["mjai_responses"]
        batch_notifications = result["batch_notifications"]

        # 1. Payload：使用最后一个有效响应
        last_response = mjai_responses[-1] if mjai_responses else {}
        payload = build_dataserver_payload(last_response, bot)

        # 2. Notifications: 从各种来源收集通知
        all_notifications = batch_notifications.copy()

        # 2.1 收集 Notification Flags
        # 优先检查 Controller (MortalBot 所在的组件)
        if controller:
            ctrl_flags = getattr(controller, "notification_flags", {})
            all_notifications.extend(NotificationHandler.from_flags(ctrl_flags))

        # 同时也检查 Bot (StateTrackerBot)
        if bot:
            bot_flags = getattr(bot, "notification_flags", {})
            all_notifications.extend(NotificationHandler.from_flags(bot_flags))

        # 2.2 检查响应中的错误
        if error_notification := NotificationHandler.from_error_response(last_response):
            all_notifications.append(error_notification)

        if all_notifications:
            self.ds.send_notifications(all_notifications)

        if payload:
            self.ds.send_recommendations(payload)

    def run(self) -> int:
        """
        使用 Reactor 模式的主应用循环。

        循环分三个阶段：
        1. _poll_inputs()   - 从事件源收集消息
        2. _process_events() - 处理消息并生成响应
        3. _emit_outputs()   - 发送结果到 DataServer
        """
        # 启动主循环
        logger.info("Starting main loop...")
        # 捕获引用以减少全局上下文访问
        app = get_app_context()
        bot = app.bot
        controller = app.controller

        try:
            while not self._stop_event.is_set():
                # 阶段 1：INPUT - 从事件队列获取消息（阻塞模式，替代轮询）
                msg = self._get_next_message(timeout=0.1)
                if not msg:
                    # Timeout, check stop event and continue
                    continue

                # 将单个消息包装为列表以兼容现有处理逻辑
                mjai_msgs = [msg]

                try:
                    # 阶段 2：PROCESS - 处理事件
                    result = self._process_events(mjai_msgs, bot, controller)

                    # 阶段 3：OUTPUT - 分发结果
                    self._emit_outputs(result, bot, controller)

                except Exception as e:
                    logger.exception(f"Critical error in main loop dispatch: {e}")
                    self._stop_event.wait(1.0)

        finally:
            self.cleanup()

        return 0

    def cleanup(self):
        logger.info("Stopping Akagi-NG...")
        app = get_app_context()
        with contextlib.suppress(Exception):
            if app.mitm_client:
                app.mitm_client.stop()
        with contextlib.suppress(Exception):
            if app.electron_client:
                app.electron_client.stop()
        with contextlib.suppress(Exception):
            self.ds.stop()
        logger.info("Akagi-NG stopped.")
