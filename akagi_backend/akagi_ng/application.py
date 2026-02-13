import queue
import signal
import threading

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
from akagi_ng.mjai_bot import Controller, StateTrackerBot
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.constants import ServerConstants
from akagi_ng.schema.protocols import (
    BotProtocol,
    ControllerProtocol,
    MessageSource,
)
from akagi_ng.schema.types import (
    MJAIEvent,
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
        self.message_queue: queue.Queue[MJAIEvent] = queue.Queue(maxsize=ServerConstants.MESSAGE_QUEUE_MAXSIZE)

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

        mjai_bot: StateTrackerBot | None = None
        mjai_controller: Controller | None = None
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
            status = BotStatusContext()
            self.status = status
            mjai_controller = Controller(status=status)
            mjai_bot = StateTrackerBot(status=status)
            logger.info("Bot components loaded successfully.")
        except ImportError as e:
            logger.error(f"Failed to load bot components or native library: {e}")

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

        sources: list[MessageSource] = []
        if app.settings.mitm.enabled and app.mitm_client:
            sources.append(app.mitm_client)
        if app.electron_client:
            sources.append(app.electron_client)

        for source in sources:
            source.start()

        self._setup_signals()
        logger.info("Akagi backend loop started.")

    def _setup_signals(self):
        """设置信号处理器以关闭程序"""

        def signal_handler(signum: int, _frame: object) -> None:
            sig_name = signal.Signals(signum).name
            logger.info(f"Received signal {sig_name} ({signum}), initiating shutdown...")
            self.stop()

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    def stop(self):
        self._stop_event.set()

    def _handle_message_logic(
        self,
        msg: MJAIEvent,
        batch_notifications: list[Notification],
        bot: BotProtocol | None,
        controller: ControllerProtocol | None,
        mjai_responses: list[MJAIResponse],
    ) -> bool:
        """统一处理消息分发的 match-case 逻辑。

        Returns:
            bool: 是否应跳过后续处理。
        """
        msg_type = msg.get("type")

        # 1. 系统管理类消息
        match msg_type:
            case "system_shutdown":
                logger.info(f"Received shutdown signal from {msg.get('source', 'unknown')}.")
                self.stop()
                return True
            case "system_event":
                if code := msg.get("code"):
                    batch_notifications.append({"code": code})
                return True

        # 2. 业务通知类消息 (直接处理来自 Bridge 的动态通知)
        if msg_type != "system_event" and (code := msg.get("code")):
            batch_notifications.append({"code": code})

        # 3. 游戏业务分发
        if controller and (resp := controller.react(msg)):
            mjai_responses.append(resp)

        if bot:
            bot.react(msg)

        return False

    def _process_message_batch(
        self, mjai_msgs: list[MJAIEvent], bot: BotProtocol | None, controller: ControllerProtocol | None
    ) -> tuple[list[MJAIResponse], list[Notification]]:
        """
        处理一批 MJAI 消息

        注意: Controller 必须在 Bot 更新状态之前响应
        Controller 基于当前状态做决策，如果 Bot 先更新状态
        Controller 将基于"未来"状态而非当前事件做出响应
        """
        mjai_responses: list[MJAIResponse] = []
        batch_notifications: list[Notification] = []

        for msg in mjai_msgs:
            try:
                if self._handle_message_logic(msg, batch_notifications, bot, controller, mjai_responses):
                    continue

                # 每一条消息处理后，统一从 Context 中采集当前累积的标志
                if self.status:
                    flags = self.status.flags
                    if flags:
                        batch_notifications.extend([{"code": code} for code, is_active in flags.items() if is_active])
                        self.status.clear_flags()

            except (ValueError, KeyError, TypeError) as e:
                logger.error(f"Invalid MJAI message format: {msg}, error: {e}")
            except Exception:
                logger.exception(f"Unexpected error processing MJAI message: {msg}")

        return mjai_responses, batch_notifications

    def _get_next_message(self, timeout: float = ServerConstants.MAIN_LOOP_POLL_TIMEOUT_SECONDS) -> MJAIEvent | None:
        """
        从事件队列获取下一条消息(阻塞、100ms超时)
        如果超时或队列为空则返回 None

        这是事件驱动的 INPUT 阶段
        """
        try:
            return self.message_queue.get(block=True, timeout=timeout)
        except queue.Empty:
            return None

    def _process_events(
        self, mjai_msgs: list[MJAIEvent], bot: BotProtocol | None, controller: ControllerProtocol | None
    ) -> ProcessResult:
        """
        处理 MJAI 消息批次
        这是 Reactor 模式的 PROCESS 阶段

        Returns:
            mjai_responses: Controller 的响应列表
            notifications: 要发送的通知列表
        """
        mjai_responses, batch_notifications = self._process_message_batch(mjai_msgs, bot, controller)

        return {
            "mjai_responses": mjai_responses,
            "batch_notifications": batch_notifications,
            "is_sync": any(msg.get("sync", False) for msg in mjai_msgs),
        }

    def _emit_outputs(self, result: ProcessResult, bot: BotProtocol | None):
        """
        将处理结果发送到 DataServer
        这是 Reactor 模式的 OUTPUT 阶段
        """
        mjai_responses: list[MJAIResponse] = result["mjai_responses"]
        batch_notifications: list[Notification] = result["batch_notifications"]
        is_sync = result.get("is_sync", False)

        # 1. Payload：使用最后一个有效响应
        last_response = mjai_responses[-1] if mjai_responses else {}
        payload = build_dataserver_payload(last_response, bot)

        # 2. Notifications: 从各种来源收集通知
        all_notifications = batch_notifications.copy()

        # 3. 检查响应中的错误
        if error_code := last_response.get("error"):
            all_notifications.append({"code": error_code})

        if all_notifications:
            self.ds.send_notifications(all_notifications)

        # 同步期间屏蔽推荐输出，仅保留通知
        if payload and not is_sync:
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
                msg = self._get_next_message(timeout=ServerConstants.MAIN_LOOP_POLL_TIMEOUT_SECONDS)
                if not msg:
                    # Timeout, check stop event and continue
                    continue

                # 将单个消息包装为列表以兼容现有处理逻辑
                mjai_msgs = [msg]

                try:
                    # 阶段 2：PROCESS - 处理事件
                    result = self._process_events(mjai_msgs, bot, controller)

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
        sources: list[MessageSource] = []
        if app.mitm_client:
            sources.append(app.mitm_client)
        if app.electron_client:
            sources.append(app.electron_client)

        for source in sources:
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
