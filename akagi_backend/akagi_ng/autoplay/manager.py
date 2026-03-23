from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Callable

from akagi_ng.autoplay.executor import WindowsInputExecutor
from akagi_ng.core.logging import logger as base_logger
from akagi_ng.autoplay.planner import ActionPlanner, PlannedClick
from akagi_ng.schema.constants import Platform
from akagi_ng.schema.protocols import StateTrackerProtocol
from akagi_ng.settings import local_settings

logger = base_logger.bind(module="autoplay")


@dataclass(slots=True)
class AutoPlayRuntime:
    platform: Platform
    window_keyword: str
    get_operation_list: Callable[[], list[dict]]
    get_operation_step: Callable[[], int | None]


class AutoPlayManager:
    def __init__(
        self,
        runtime_provider: Callable[[], AutoPlayRuntime],
        executor: WindowsInputExecutor | None = None,
    ):
        self._runtime_provider = runtime_provider
        self._planner = ActionPlanner()
        self._executor = executor or WindowsInputExecutor()
        self._task: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def observe_event(self, event) -> None:
        self._planner.observe_event(event)
        if getattr(event, "type", None) in {"start_game", "start_kyoku", "end_kyoku", "end_game"}:
            self.stop()

    def execute(self, response: dict | None, tracker: StateTrackerProtocol | None) -> bool:
        if not local_settings.autoplay.enabled or response is None or tracker is None:
            return False
        if not self._executor.available:
            logger.warning("Autoplay requested but Windows input executor is unavailable.")
            return False

        runtime = self._runtime_provider()
        operation_list = runtime.get_operation_list()
        operation_step = runtime.get_operation_step()
        self._planner.update_operation_list(operation_list)
        plan = self._planner.plan(
            response,
            tracker.tehai_mjai_with_aka,
            tracker.last_self_tsumo,
            player_state=tracker.player_state,
            last_kawa_tile=tracker.last_kawa_tile,
        )
        if not plan:
            logger.warning(
                "Autoplay produced no plan: "
                f"response={self._describe_response(response)} "
                f"tehai={tracker.tehai_mjai_with_aka} "
                f"tsumohai={tracker.last_self_tsumo} "
                f"last_kawa={tracker.last_kawa_tile} "
                f"operations={self._describe_operation_list(operation_list)} "
                f"step={operation_step}"
            )
            return False

        logger.info(
            "Autoplay plan created: "
            f"response={self._describe_response(response)} "
            f"tehai={tracker.tehai_mjai_with_aka} "
            f"tsumohai={tracker.last_self_tsumo} "
            f"last_kawa={tracker.last_kawa_tile} "
            f"operations={self._describe_operation_list(operation_list)} "
            f"plan={self._describe_plan(plan)} "
            f"step={operation_step}"
        )
        self.stop()
        self._stop_event = threading.Event()
        self._task = threading.Thread(
            target=self._run_plan,
            args=(plan, runtime, operation_step, self._stop_event),
            name="AutoPlayTask",
            daemon=True,
        )
        self._task.start()
        return True

    def stop(self) -> None:
        with self._lock:
            if self._task and self._task.is_alive():
                self._stop_event.set()
                self._task.join(timeout=0.2)
            self._task = None

    def _run_plan(
        self,
        plan: list[PlannedClick],
        runtime: AutoPlayRuntime,
        operation_step: int | None,
        stop_event: threading.Event,
    ) -> None:
        if not self._executor.ensure_target_window(runtime.platform, runtime.window_keyword):
            logger.warning("Autoplay aborted: target window not found.")
            return

        self._executor.focus_target_window()
        for click in plan:
            if not self._sleep(click.delay, stop_event):
                logger.debug(f"Autoplay cancelled during delay for {click.label}.")
                return
            if click.requires_operation_step and operation_step is not None:
                current_step = runtime.get_operation_step()
                if current_step != operation_step:
                    logger.info(
                        f"Autoplay aborted: operation step changed for {click.label} "
                        f"({operation_step} -> {current_step})."
                    )
                    return

            geometry = self._executor.get_target_geometry()
            if geometry is None:
                logger.warning(f"Autoplay aborted: target geometry unavailable for {click.label}.")
                return

            target = self._executor.normalized_to_screen(geometry, click.coord)
            logger.info(
                "Autoplay executing click: "
                f"label={click.label} "
                f"delay={click.delay:.3f}s "
                f"coord={click.coord} "
                f"screen={target} "
                f"geometry=({geometry.left},{geometry.top},{geometry.width},{geometry.height}) "
                f"expected_types={click.expected_types}"
            )
            if not self._executor.move_to(target, cancel_requested=stop_event.is_set):
                logger.info(f"Autoplay aborted during cursor movement for {click.label}.")
                return
            if stop_event.is_set():
                logger.debug(f"Autoplay stop requested before click {click.label}.")
                return

            self._executor.focus_target_window()
            if not self._executor.click_with_retry(
                target,
                click.expected_types,
                runtime.get_operation_list if runtime.platform == Platform.MAJSOUL else None,
                cancel_requested=stop_event.is_set,
            ):
                logger.warning(
                    f"Autoplay click did not resolve expected operation for {click.label}: "
                    f"{click.expected_types}"
                )
                return
            logger.info(f"Autoplay click succeeded: {click.label}")

    def _sleep(self, delay: float, stop_event: threading.Event) -> bool:
        deadline = time.time() + max(delay, 0.0)
        while time.time() < deadline:
            if stop_event.wait(timeout=0.05):
                return False
        return not stop_event.is_set()

    def _describe_response(self, response: dict | None) -> str:
        if not response:
            return "None"
        return (
            f"type={response.get('type')} "
            f"pai={response.get('pai')} "
            f"tsumogiri={response.get('tsumogiri')} "
            f"consumed={response.get('consumed')} "
            f"reach_dahai={response.get('reach_dahai')}"
        )

    def _describe_operation_list(self, operation_list: list[dict]) -> list[dict]:
        return [
            {
                "type": item.get("type"),
                "combination_count": len(item.get("combination", [])),
                "combination_preview": list(item.get("combination", []))[:3],
            }
            for item in operation_list
        ]

    def _describe_plan(self, plan: list[PlannedClick]) -> list[dict]:
        return [
            {
                "label": click.label,
                "coord": click.coord,
                "delay": round(click.delay, 3),
                "expected_types": click.expected_types,
                "requires_step": click.requires_operation_step,
            }
            for click in plan
        ]
