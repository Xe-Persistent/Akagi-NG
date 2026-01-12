import contextlib
import signal
import threading
import time
import webbrowser

from akagi_ng.core import context, paths
from akagi_ng.core.event_handler import NotificationHandler
from akagi_ng.core.logging import configure_logging, logger
from akagi_ng.core.notification_codes import NotificationCode
from akagi_ng.dataserver.adapter import build_dataserver_payload
from akagi_ng.dataserver.dataserver import DataServer
from akagi_ng.mitm_client.client import MitmClient
from akagi_ng.playwright_client.client import PlaywrightClient
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


class AkagiApp:
    def __init__(self):
        from akagi_ng import AKAGI_VERSION

        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")
        paths.ensure_runtime_dirs()
        paths.configure_playwright_env()

        settings = loaded_settings
        configure_logging(settings.log_level)

        self._stop_event = threading.Event()
        self.missing_resources: list[str] = []

        # DataServer
        host, port = settings.server.host, settings.server.port
        self.ds = DataServer(host=host, external_port=port)

        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        # 初始化组件和全局上下文
        mjai_bot, mjai_controller = self._load_bot_components()
        context.app = context.AppContext(
            settings=settings,
            controller=mjai_controller,
            bot=mjai_bot,
            playwright_client=PlaywrightClient(frontend_url=self.frontend_url),
            mitm_client=MitmClient(),
        )

        self.is_browser_mode = settings.browser.enabled

    def _check_directory(self, path_getter, resource_name: str) -> bool:
        """检查目录是否存在且非空"""
        directory = path_getter()
        if not directory.exists() or not any(directory.iterdir()):
            self.missing_resources.append(resource_name)
            return False
        return True

    def _load_bot_components(self):
        """如果资源可用则加载 bot/controller"""
        # 检查必需目录
        if not self._check_directory(paths.get_lib_dir, "lib"):
            return None, None

        # 尝试加载原生库
        try:
            import akagi_ng.core.lib_loader  # noqa: F401
        except ImportError:
            self.missing_resources.append("lib")
            return None, None

        if not self._check_directory(paths.get_models_dir, "models"):
            return None, None

        # 加载 bot 模块
        try:
            from akagi_ng.mjai_bot.bot import StateTrackerBot
            from akagi_ng.mjai_bot.controller import Controller

            return StateTrackerBot(), Controller()
        except ImportError as e:
            logger.error(f"Failed to load bot modules: {e}")
            self.missing_resources.append("bot")
            return None, None

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

        if self.missing_resources:
            logger.error(f"Missing resources: {self.missing_resources}")
            threading.Thread(target=self._send_error_delayed, daemon=True).start()

    def _send_error_delayed(self):
        time.sleep(2.0)
        self.ds.update_system_error(NotificationCode.MISSING_RESOURCES, ", ".join(self.missing_resources))

    def _setup_signals(self):
        signal.signal(signal.SIGINT, lambda *_: self.stop())
        with contextlib.suppress(Exception):
            signal.signal(signal.SIGTERM, lambda *_: self.stop())

    def stop(self):
        self._stop_event.set()

    def _process_message_batch(self, mjai_msgs: list[dict]) -> tuple[list[dict], list[dict]]:
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
                if context.app.controller and (resp := context.app.controller.react(msg)):
                    mjai_responses.append(resp)
                if context.app.bot:
                    context.app.bot.react(msg)

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

    def _process_events(self, mjai_msgs: list[dict]) -> dict:
        """
        Process the batch of MJAI messages.
        This is the PROCESS phase of the Reactor pattern.

        Returns a result dict containing:
            - mjai_responses: List of responses from controller
            - notifications: List of notifications to send
        """
        mjai_responses, batch_notifications = self._process_message_batch(mjai_msgs)
        return {
            "mjai_responses": mjai_responses,
            "batch_notifications": batch_notifications,
        }

    def _emit_outputs(self, result: dict) -> None:
        """
        Send processed results to the DataServer.
        This is the OUTPUT phase of the Reactor pattern.
        """
        if not context.app.bot or self.missing_resources:
            return

        mjai_responses = result["mjai_responses"]
        batch_notifications = result["batch_notifications"]

        # 1. Payload：目前使用最后一个有效响应
        # TODO: 如果多响应变得常见，考虑合并策略
        last_response = mjai_responses[-1] if mjai_responses else {}
        payload = build_dataserver_payload(last_response, context.app.bot)

        # 2. Notifications: 从各种来源收集通知
        all_notifications = batch_notifications.copy()

        # 2.1 从 bot.notification_flags 收集引擎和 bot 状态通知
        if context.app.bot:
            notification_flags = getattr(context.app.bot, "notification_flags", {})
            bot_notifications = NotificationHandler.from_flags(notification_flags)
            all_notifications.extend(bot_notifications)

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
                    result = self._process_events(mjai_msgs)

                    # 阶段 3：OUTPUT - 分发结果
                    self._emit_outputs(result)

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
