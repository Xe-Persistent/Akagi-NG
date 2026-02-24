import queue
import signal
import threading
from types import FrameType

from akagi_ng.core import (
    AppContext,
    configure_logging,
    get_app_context,
    logger,
    set_app_context,
)
from akagi_ng.dataserver import DataServer
from akagi_ng.dataserver.adapter import build_dataserver_payload
from akagi_ng.mitm_client import MitmClient
from akagi_ng.mjai_bot import Controller, StateTracker
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.constants import ServerConstants
from akagi_ng.schema.protocols import (
    BotProtocol,
    ControllerProtocol,
)
from akagi_ng.schema.types import (
    AkagiEvent,
    MJAIResponse,
    Notification,
    ProcessResult,
)
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


class AkagiApp:
    def __init__(self):
        self._stop_event = threading.Event()
        self.ds: DataServer | None = None
        self.status: BotStatusContext | None = None
        self.frontend_url = ""
        self.message_queue: queue.Queue[AkagiEvent] = queue.Queue(maxsize=ServerConstants.MESSAGE_QUEUE_MAXSIZE)

    def initialize(self):
        import importlib

        from akagi_ng import AKAGI_VERSION
        from akagi_ng.electron_client import create_electron_client

        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")

        settings = loaded_settings
        configure_logging(settings.log_level)

        host, port = settings.server.host, settings.server.port
        self.ds = DataServer(host=host, external_port=port)

        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        mjai_bot: StateTracker | None = None
        mjai_controller: Controller | None = None
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
            status = BotStatusContext()
            self.status = status
            mjai_controller = Controller(status=status)
            mjai_bot = StateTracker(status=status)
            logger.info("Bot components loaded successfully.")
        except ImportError:
            logger.exception("Failed to load bot components or native library")

        app_context = AppContext(
            settings=settings,
            controller=mjai_controller,
            bot=mjai_bot,
            mitm_client=MitmClient(shared_queue=self.message_queue),
            electron_client=create_electron_client(settings.platform, shared_queue=self.message_queue),
            shared_queue=self.message_queue,
        )

        set_app_context(app_context)

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        app = get_app_context()

        for source in filter(
            None,
            (
                app.mitm_client if app.settings.mitm.enabled else None,
                app.electron_client,
            ),
        ):
            source.start()

        self._setup_signals()
        logger.info("Akagi backend loop started.")

    def _setup_signals(self):
        """设置信号处理器以关闭程序"""

        def signal_handler(signum: int, _frame: FrameType | None):
            sig_name = signal.Signals(signum).name
            logger.info(f"Received signal {sig_name} ({signum}), initiating shutdown...")
            self.stop()

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    def stop(self):
        self._stop_event.set()

    def _handle_message_logic(
        self, msg: AkagiEvent, bot: BotProtocol | None, controller: ControllerProtocol | None
    ) -> tuple[MJAIResponse | None, Notification | None, bool]:
        """统一处理消息分发的 match-case 逻辑。

        Returns:
            (response, notification, handled)
        """
        match msg:
            # 1. 纯系统级别的管理事件 (不流向 Game Logic)
            case {"type": "system_shutdown"}:
                logger.info("Received shutdown signal.")
                self.stop()
                return None, None, True
            case {"type": "system_event", "code": code}:
                return None, {"code": code}, True

            # 2. 属于 Game Logic / MJAI 范畴的协议事件
            case _:
                resp = controller.react(msg) if controller else None
                if bot:
                    bot.react(msg)
                return resp, None, False

    def _process_event(
        self, msg: AkagiEvent, bot: BotProtocol | None, controller: ControllerProtocol | None
    ) -> ProcessResult:
        """
        处理单条 MJAI 消息
        这是 Reactor 模式的 PROCESS 阶段
        """
        response: MJAIResponse | None = None
        notifications: list[Notification] = []

        try:
            resp, sys_notif, handled = self._handle_message_logic(msg, bot, controller)
            if resp:
                response = resp
            if sys_notif:
                notifications.append(sys_notif)

            # 每一条消息处理后，统一从 Context 中采集当前累积的标志
            if not handled and self.status and self.status.flags:
                notifications.extend({"code": k} for k, v in self.status.flags.items() if v)
                self.status.clear_flags()

        except Exception:
            logger.exception(f"Unexpected error processing MJAI message: {msg}")

        return ProcessResult(
            response=response,
            notifications=notifications,
            is_sync=msg.get("sync", False),
        )

    def _emit_outputs(self, result: ProcessResult, bot: BotProtocol | None):
        """
        将处理结果发送到 DataServer
        这是 Reactor 模式的 OUTPUT 阶段
        """
        response = result["response"] or MJAIResponse(type="none")
        payload = build_dataserver_payload(response, bot)

        if notifications := result["notifications"]:
            self.ds.send_notifications(notifications)

        # 同步期间屏蔽推荐输出，仅保留通知
        if payload and not result["is_sync"]:
            self.ds.send_recommendations(payload)

    def run(self) -> int:
        """
        使用 Reactor 模式的主应用循环。

        循环分三个阶段：
        1. message_queue.get()  - 从事件队列收集消息
        2. _process_event()     - 处理消息并生成响应
        3. _emit_outputs()      - 发送结果到 DataServer
        """
        # 启动主循环
        logger.info("Starting main loop...")
        # 捕获引用以减少全局上下文访问
        app = get_app_context()
        bot = app.bot
        controller = app.controller

        try:
            while not self._stop_event.is_set():
                # 阶段 1：INPUT - 从事件队列获取消息 (阻塞、100ms超时)
                try:
                    msg = self.message_queue.get(block=True, timeout=ServerConstants.MAIN_LOOP_POLL_TIMEOUT_SECONDS)
                except queue.Empty:
                    continue

                try:
                    # 阶段 2：PROCESS - 处理事件
                    result = self._process_event(msg, bot, controller)

                    # 阶段 3：OUTPUT - 分发结果
                    self._emit_outputs(result, bot)

                except Exception as e:
                    logger.exception(f"Critical error in main loop dispatch: {e}")
                    self._stop_event.wait(1.0)

        finally:
            self.cleanup()

        return 0

    def cleanup(self):
        """清理资源并记录详细的关闭日志"""
        logger.info("Stopping Akagi-NG...")
        app = get_app_context()

        # 停止消息源
        for source in filter(None, (app.mitm_client, app.electron_client)):
            try:
                logger.info(f"Stopping {source.__class__.__name__}...")
                source.stop()
            except Exception as e:
                logger.error(f"Error stopping {source.__class__.__name__}: {e}")

        # 停止 DataServer
        if self.ds:
            try:
                logger.info("Stopping DataServer...")
                self.ds.stop()
            except Exception as e:
                logger.error(f"Error stopping DataServer: {e}")

        logger.info("Akagi-NG stopped successfully.")
