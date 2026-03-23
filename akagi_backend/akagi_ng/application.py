import importlib
import queue
import signal
import threading
from types import FrameType

from akagi_ng import AKAGI_VERSION
from akagi_ng.autoplay import AutoPlayManager, AutoPlayRuntime
from akagi_ng.core.context import AppContext, get_app_context, set_app_context
from akagi_ng.core.logging import configure_logging, logger
from akagi_ng.dataserver import DataServer
from akagi_ng.electron_client import create_electron_client
from akagi_ng.mitm_client import MitmClient
from akagi_ng.mjai_bot import Controller, StateTracker
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.constants import Platform, ServerConstants
from akagi_ng.schema.protocols import ControllerProtocol, StateTrackerProtocol
from akagi_ng.schema.types import (
    AkagiEvent,
    MJAIEventBase,
    MJAIResponse,
    Notification,
    ProcessResult,
    SystemEvent,
    SystemShutdownEvent,
)
from akagi_ng.settings import local_settings as loaded_settings

logger = logger.bind(module="akagi")


class AkagiApp:
    def __init__(self):
        self._stop_event = threading.Event()
        self.ds: DataServer | None = None
        self.status: BotStatusContext | None = None
        self.autoplay: AutoPlayManager | None = None
        self.frontend_url = ""
        self.message_queue: queue.Queue[AkagiEvent] = queue.Queue(maxsize=ServerConstants.MESSAGE_QUEUE_MAXSIZE)

    def initialize(self):
        logger.info(f"Starting Akagi-NG {AKAGI_VERSION}...")

        settings = loaded_settings
        configure_logging(settings.log_level)

        host, port = settings.server.host, settings.server.port
        self.ds = DataServer(host=host, external_port=port)

        target_host = "127.0.0.1" if host == "0.0.0.0" else host
        self.frontend_url = f"http://{target_host}:{port}/"

        tracker: StateTracker | None = None
        controller: Controller | None = None
        try:
            importlib.import_module("akagi_ng.core.lib_loader")
            status = BotStatusContext()
            self.status = status
            controller = Controller(status=status)
            tracker = StateTracker(status=status)
            logger.info("Components loaded successfully.")
        except ImportError:
            logger.exception("Failed to load components")

        app_context = AppContext(
            settings=settings,
            controller=controller,
            state_tracker=tracker,
            mitm_client=MitmClient(shared_queue=self.message_queue),
            electron_client=create_electron_client(settings.platform, shared_queue=self.message_queue),
            shared_queue=self.message_queue,
        )
        set_app_context(app_context)
        self.autoplay = AutoPlayManager(runtime_provider=self._build_autoplay_runtime)

    def start(self):
        self.ds.start()
        logger.info(f"DataServer started at {self.frontend_url}")

        app = get_app_context()
        for source in filter(None, (app.mitm_client if app.settings.mitm.enabled else None, app.electron_client)):
            source.start()

        self._setup_signals()

    def _setup_signals(self):
        def signal_handler(signum: int, _frame: FrameType | None):
            sig_name = signal.Signals(signum).name
            logger.info(f"Received signal {sig_name} ({signum}), initiating shutdown...")
            self.stop()

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    def stop(self):
        self._stop_event.set()

    def _get_active_bridge(self):
        app = get_app_context()
        if app.settings.mitm.enabled and app.mitm_client and app.mitm_client.addon:
            addon = app.mitm_client.addon
            if addon.activated_flows:
                flow_id = addon.activated_flows[-1]
                return addon.bridges.get(flow_id)
            if addon.bridges:
                return list(addon.bridges.values())[-1]
        if app.electron_client:
            return getattr(app.electron_client, "bridge", None)
        return None

    def _detect_autoplay_platform(self) -> Platform:
        app = get_app_context()
        if app.settings.platform != Platform.AUTO:
            return app.settings.platform

        bridge = self._get_active_bridge()
        bridge_name = bridge.__class__.__name__.lower() if bridge else ""
        if "tenhou" in bridge_name:
            return Platform.TENHOU
        if "riichi" in bridge_name:
            return Platform.RIICHI_CITY
        if "amatsuki" in bridge_name:
            return Platform.AMATSUKI
        return Platform.MAJSOUL

    def _get_latest_operation_list(self) -> list[dict]:
        bridge = self._get_active_bridge()
        operation_list = getattr(bridge, "latest_self_operation_list", [])
        return list(operation_list) if isinstance(operation_list, list) else []

    def _get_latest_operation_step(self) -> int | None:
        bridge = self._get_active_bridge()
        step = getattr(bridge, "latest_operation_step", None)
        return int(step) if step is not None else None

    def _build_autoplay_runtime(self) -> AutoPlayRuntime:
        app = get_app_context()
        return AutoPlayRuntime(
            platform=self._detect_autoplay_platform(),
            window_keyword=app.settings.autoplay.window_keyword,
            get_operation_list=self._get_latest_operation_list,
            get_operation_step=self._get_latest_operation_step,
        )

    def _handle_message(
        self, msg: AkagiEvent, tracker: StateTrackerProtocol | None, controller: ControllerProtocol | None
    ) -> tuple[str | None, bool, bool]:
        match msg:
            case SystemShutdownEvent():
                logger.info("Received shutdown signal.")
                self.stop()
                return None, True, False
            case SystemEvent(code=code):
                return code, True, False
            case MJAIEventBase(sync=is_sync):
                pass
            case _:
                is_sync = False

        if controller:
            controller.react(msg)
        if tracker:
            tracker.react(msg)
        if self.autoplay and isinstance(msg, MJAIEventBase):
            self.autoplay.observe_event(msg)
        return None, False, is_sync

    def _process_event(
        self, msg: AkagiEvent, tracker: StateTrackerProtocol | None, controller: ControllerProtocol | None
    ) -> ProcessResult:
        response: MJAIResponse | None = None
        notifications: list[Notification] = []
        is_sync = False

        try:
            msg_code, handled, is_sync = self._handle_message(msg, tracker, controller)
            if controller and not handled:
                response = controller.last_response

            if msg_code:
                notifications.append(Notification(code=msg_code))

            if not handled and self.status and self.status.flags:
                notifications.extend(Notification(code=code) for code in self.status.flags)
                self.status.clear_flags()
        except Exception:
            logger.exception(f"Unexpected error processing MJAI message: {msg}")

        return ProcessResult(response=response, notifications=notifications, is_sync=is_sync)

    def _emit_outputs(self, result: ProcessResult, tracker: StateTrackerProtocol | None):
        if notifications := result.notifications:
            self.ds.send_notifications(notifications)

        if result.is_sync or tracker is None:
            return

        response = result.response or MJAIResponse(type="none")
        payload = tracker.build_recommendations(response)
        if self.autoplay:
            self.autoplay.execute(result.response, tracker)

        if payload:
            self.ds.send_recommendations(payload)

    def run(self) -> int:
        logger.info("Starting main loop...")
        app = get_app_context()
        tracker = app.state_tracker
        controller = app.controller

        try:
            while not self._stop_event.is_set():
                try:
                    msg = self.message_queue.get(block=True, timeout=ServerConstants.MAIN_LOOP_POLL_TIMEOUT_SECONDS)
                except queue.Empty:
                    continue

                try:
                    result = self._process_event(msg, tracker, controller)
                    self._emit_outputs(result, tracker)
                except Exception as e:
                    logger.exception(f"Critical error in main loop dispatch: {e}")
                    self._stop_event.wait(1.0)
        finally:
            self.cleanup()

        return 0

    def cleanup(self):
        logger.info("Stopping Akagi-NG...")
        app = get_app_context()

        if self.autoplay:
            self.autoplay.stop()

        for source in filter(None, (app.mitm_client, app.electron_client)):
            try:
                logger.info(f"Stopping {source.__class__.__name__}...")
                source.stop()
            except Exception as e:
                logger.error(f"Error stopping {source.__class__.__name__}: {e}")

        if self.ds:
            try:
                logger.info("Stopping DataServer...")
                self.ds.stop()
            except Exception as e:
                logger.error(f"Error stopping DataServer: {e}")

        logger.info("Akagi-NG stopped successfully.")
