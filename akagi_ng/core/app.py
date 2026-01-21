import contextlib
import signal
import threading
import webbrowser

from akagi_ng.core import NotificationCode, NotificationHandler, context, paths
from akagi_ng.core.logging import configure_logging, logger
from akagi_ng.dataserver import DataServer
from akagi_ng.dataserver.adapter import build_dataserver_payload
from akagi_ng.mitm_client import MitmClient
from akagi_ng.mjai_bot import Controller, StateTrackerBot
from akagi_ng.playwright_client import PlaywrightClient
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


class AkagiApp:
    def __init__(self):
        self._stop_event = threading.Event()
        self.missing_resources: list[str] = []
        self.ds: DataServer | None = None
        self.frontend_url = ""
        self.is_browser_mode = False

    def initialize(self):
        from akagi_ng import AKAGI_VERSION
        from akagi_ng.core.loader import ComponentLoader

        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")
        paths.ensure_runtime_dirs()
        paths.configure_playwright_env()

        settings = loaded_settings
        configure_logging(settings.log_level)
        self.is_browser_mode = settings.browser.enabled

        # DataServer
        host, port = settings.server.host, settings.server.port
        self.ds = DataServer(host=host, external_port=port)

        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        # Loader
        loader = ComponentLoader()
        mjai_bot, mjai_controller = loader.load_bot_components()
        self.missing_resources = loader.missing_resources

        context.app = context.AppContext(
            settings=settings,
            controller=mjai_controller,
            bot=mjai_bot,
            playwright_client=PlaywrightClient(frontend_url=self.frontend_url),
            mitm_client=MitmClient(),
        )

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        # 根据模式启动相应客户端
        if self.is_browser_mode and context.app.playwright_client:
            context.app.playwright_client.start()
        elif context.app.settings.mitm.enabled and context.app.mitm_client:
            webbrowser.open(self.frontend_url)
            context.app.mitm_client.start()

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
        if self.missing_resources:
            return [], []

        mjai_responses: list[dict] = []
        batch_notifications: list[dict] = []

        for msg in mjai_msgs:
            try:
                # 1. Extract notifications
                if n := NotificationHandler.from_message(msg):
                    batch_notifications.append(n)
                    if msg.get("type") == "system_event":
                        continue

                # 2. Controller -> 3. Bot (order matters, see docstring)
                if controller and (resp := controller.react(msg)):
                    mjai_responses.append(resp)
                if bot:
                    bot.react(msg)

            except Exception:
                logger.exception(f"Error processing mjai msg: {msg}")

        return mjai_responses, batch_notifications

    def _poll_inputs(self) -> list[dict]:
        """
        Poll all event sources and collect incoming MJAI messages.
        This is the INPUT phase of the Reactor pattern.
        """
        mjai_msgs: list[dict] = []
        if context.app.playwright_client:
            mjai_msgs.extend(context.app.playwright_client.dump_messages())
        if context.app.mitm_client:
            mjai_msgs.extend(context.app.mitm_client.dump_messages())
        return mjai_msgs

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
        if self.missing_resources:
            return

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

    def _should_exit(self) -> bool:
        """检查主循环是否应退出"""
        if (
            self.is_browser_mode
            and context.app.playwright_client
            and not context.app.playwright_client.controller.running
        ):
            logger.info("Playwright controller stopped. Exiting.")
            return True
        return False

    def run(self) -> int:
        """
        使用 Reactor 模式的主应用循环。

        循环分三个阶段：
        1. _poll_inputs()   - 从事件源收集消息
        2. _process_events() - 处理消息并生成响应
        3. _emit_outputs()   - 发送结果到 DataServer
        """
        # 循环前检查：如果需要，发送错误通知
        if self.missing_resources:
            logger.error(f"Missing resources: {self.missing_resources}")
            self.ds.update_system_error(NotificationCode.MISSING_RESOURCES, ", ".join(self.missing_resources))

        # 启动主循环
        logger.info("Starting main loop...")
        # 捕获引用以减少全局上下文访问
        bot = context.app.bot
        controller = context.app.controller

        try:
            while not self._stop_event.is_set():
                if self._should_exit():
                    break

                # 阶段 1：INPUT - 轮询所有事件源
                mjai_msgs = self._poll_inputs()
                if not mjai_msgs:
                    self._stop_event.wait(0.05)
                    continue

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
        with contextlib.suppress(Exception):
            if context.app.playwright_client:
                context.app.playwright_client.stop()
        with contextlib.suppress(Exception):
            if context.app.mitm_client:
                context.app.mitm_client.stop()
        with contextlib.suppress(Exception):
            self.ds.stop()
        logger.info("Akagi-NG stopped.")
