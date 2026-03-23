from __future__ import annotations

import ctypes
import math
import os
import random
import time
from dataclasses import dataclass

from akagi_ng.core.logging import logger as base_logger
from akagi_ng.schema.constants import Platform
from akagi_ng.settings import local_settings

logger = base_logger.bind(module="autoplay-executor")


@dataclass(slots=True)
class WindowObject:
    hwnd: int
    name: str


@dataclass(slots=True)
class WindowGeometry:
    left: int
    top: int
    width: int
    height: int


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class MouseInput(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class InputUnion(ctypes.Union):
    _fields_ = [("mi", MouseInput)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", InputUnion)]


class WindowsInputExecutor:
    def __init__(self):
        self._target_hwnd: int | None = None
        self._user32 = ctypes.windll.user32 if hasattr(ctypes, "windll") else None
        self._input = ctypes.windll.user32 if hasattr(ctypes, "windll") else None

    @property
    def available(self) -> bool:
        return self._user32 is not None and os.name == "nt"

    def ensure_target_window(self, platform: Platform | str, custom_keyword: str = "") -> bool:
        if not self.available:
            return False
        if self._check_window():
            logger.info(f"Reusing autoplay target window hwnd={self._target_hwnd}")
            return True
        selected = self._auto_select_window(platform, custom_keyword)
        if selected is None:
            logger.warning(
                f"Failed to locate autoplay target window for platform={platform} keyword={custom_keyword!r}"
            )
            return False
        logger.info(f"Selected autoplay target window hwnd={selected.hwnd} title={selected.name!r}")
        return True

    def move_to(self, target: tuple[int, int], *, cancel_requested) -> bool:
        if not self.available:
            return False
        start = POINT()
        self._user32.GetCursorPos(ctypes.byref(start))
        start_point = (start.x, start.y)
        distance = math.hypot(target[0] - start_point[0], target[1] - start_point[1])
        path = self._build_bezier_path(start_point, target)
        if not path:
            return True
        duration = min(0.24, max(0.12, distance / 2200.0))
        step_delay = duration / max(len(path), 1)
        for point in path:
            if cancel_requested():
                return False
            self._user32.SetCursorPos(int(point[0]), int(point[1]))
            time.sleep(step_delay)
        return True

    def left_click(self) -> None:
        if self._input is None:
            return

        try:
            extra = ctypes.c_ulong(0)
            down = INPUT()
            down.type = 0
            down.union.mi = MouseInput(
                dx=0,
                dy=0,
                mouseData=0,
                dwFlags=0x0002,
                time=0,
                dwExtraInfo=ctypes.pointer(extra),
            )
            up = INPUT()
            up.type = 0
            up.union.mi = MouseInput(
                dx=0,
                dy=0,
                mouseData=0,
                dwFlags=0x0004,
                time=0,
                dwExtraInfo=ctypes.pointer(extra),
            )
            event_arr = (INPUT * 2)(down, up)
            sent = self._input.SendInput(2, ctypes.byref(event_arr), ctypes.sizeof(INPUT))
            if sent != 2:
                raise RuntimeError(f"SendInput sent {sent}/2 events")
        except Exception:
            self._user32.mouse_event(0x0002, 0, 0, 0, 0)
            time.sleep(0.012)
            self._user32.mouse_event(0x0004, 0, 0, 0, 0)

    def focus_target_window(self) -> None:
        if self._target_hwnd is None or self._user32 is None:
            return
        try:
            if self._user32.IsIconic(self._target_hwnd):
                self._user32.ShowWindow(self._target_hwnd, 9)
            self._user32.SetForegroundWindow(self._target_hwnd)
        except Exception:
            return

    def get_target_geometry(self) -> WindowGeometry | None:
        return self._get_window_geometry(self._target_hwnd)

    def normalized_to_screen(self, geometry: WindowGeometry, coord: tuple[float, float]) -> tuple[int, int]:
        scale = min(geometry.width / 16.0, geometry.height / 9.0)
        play_width = 16.0 * scale
        play_height = 9.0 * scale
        offset_x = geometry.left + (geometry.width - play_width) / 2.0
        offset_y = geometry.top + (geometry.height - play_height) / 2.0
        return (
            int(offset_x + coord[0] * scale),
            int(offset_y + coord[1] * scale),
        )

    def operation_still_available(self, expected_types: tuple[int, ...], get_operation_list) -> bool:
        if not expected_types:
            return False
        operation_list = get_operation_list()
        return any(op.get("type") in expected_types for op in operation_list)

    def click_with_retry(self, target: tuple[int, int], expected_types: tuple[int, ...], get_operation_list, *, cancel_requested) -> bool:
        max_attempts = 2
        for attempt in range(1, max_attempts + 1):
            if cancel_requested():
                return False
            logger.info(
                f"Autoplay click attempt {attempt}/{max_attempts} at screen={target} expected_types={expected_types}"
            )
            self.left_click()

            if not expected_types or get_operation_list is None:
                logger.info("Autoplay click accepted without operation-list verification.")
                return True

            for _ in range(6):
                if cancel_requested():
                    return False
                time.sleep(0.1)
                if not self.operation_still_available(expected_types, get_operation_list):
                    logger.info(f"Autoplay click verified on attempt {attempt}/{max_attempts}.")
                    return True

            if attempt < max_attempts:
                logger.warning(
                    f"Autoplay click attempt {attempt}/{max_attempts} did not clear expected operations; retrying."
                )
                jitter_x = random.randint(-2, 2)
                jitter_y = random.randint(-2, 2)
                self._user32.SetCursorPos(target[0] + jitter_x, target[1] + jitter_y)
                time.sleep(0.015)
                self._user32.SetCursorPos(target[0], target[1])
                time.sleep(0.015)
        logger.warning(f"Autoplay click failed after {max_attempts} attempts at screen={target}.")
        return False

    def _check_window(self) -> bool:
        if self._target_hwnd is None or self._user32 is None:
            return False
        return bool(self._user32.IsWindow(self._target_hwnd) and self._user32.IsWindowVisible(self._target_hwnd))

    def _auto_select_window(self, platform: Platform | str, custom_keyword: str = "") -> WindowObject | None:
        keywords = self._window_keywords(platform, custom_keyword)
        windows = self._get_windows()
        if not windows:
            return None

        for window in windows:
            lowered = window.name.lower()
            if any(keyword in lowered for keyword in keywords):
                self._target_hwnd = window.hwnd
                return window

        if len(windows) == 1:
            self._target_hwnd = windows[0].hwnd
            return windows[0]
        return None

    def _window_keywords(self, platform: Platform | str, custom_keyword: str = "") -> tuple[str, ...]:
        raw_custom = [part.strip().lower() for part in custom_keyword.replace("|", ",").split(",") if part.strip()]
        if raw_custom:
            return tuple(raw_custom)

        normalized = platform if isinstance(platform, Platform) else Platform(platform)
        match normalized:
            case Platform.MAJSOUL | Platform.AUTO:
                return ("mahjong soul", "majsoul", "jantama", "\u96c0\u9b42")
            case Platform.TENHOU:
                return ("tenhou", "\u5929\u9cf3")
            case Platform.RIICHI_CITY:
                return ("riichi city", "\u9ebb\u5c06\u4e00\u756a\u8857")
            case Platform.AMATSUKI:
                return ("amatsuki", "\u5929\u6708\u9ebb\u5c06")
        return ("mahjong", "riichi")

    def _get_windows(self) -> list[WindowObject]:
        if self._user32 is None:
            return []

        windows: list[WindowObject] = []
        current_pid = os.getpid()

        @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        def enum_windows_proc(hwnd, _lparam):
            if not self._user32.IsWindowVisible(hwnd):
                return True
            if self._user32.IsIconic(hwnd):
                return True
            length = self._user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            title = ctypes.create_unicode_buffer(length + 1)
            self._user32.GetWindowTextW(hwnd, title, length + 1)
            name = title.value.strip()
            if not name or self._is_ignored_window(name):
                return True
            pid = ctypes.c_ulong()
            self._user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if int(pid.value) == current_pid:
                return True
            geometry = self._get_window_geometry(int(hwnd))
            if geometry is None or geometry.width < 640 or geometry.height < 360:
                return True
            windows.append(WindowObject(hwnd=int(hwnd), name=name))
            return True

        self._user32.EnumWindows(enum_windows_proc, 0)
        return windows

    def _get_window_geometry(self, hwnd: int | None) -> WindowGeometry | None:
        if hwnd is None or self._user32 is None:
            return None
        rect = RECT()
        if not self._user32.GetClientRect(hwnd, ctypes.byref(rect)):
            return None
        origin = POINT(0, 0)
        if not self._user32.ClientToScreen(hwnd, ctypes.byref(origin)):
            return None
        return WindowGeometry(
            left=origin.x,
            top=origin.y,
            width=rect.right - rect.left,
            height=rect.bottom - rect.top,
        )

    def _build_bezier_path(self, start: tuple[int, int], end: tuple[int, int]) -> list[tuple[float, float]]:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        distance = math.hypot(dx, dy)
        if distance < 1:
            return [end]

        steps = max(int(local_settings.autoplay.input.bezier_steps), 10)
        steps = min(42, steps + max(0, int(distance / 18)))
        smoothing = max(0.0, min(local_settings.autoplay.input.bezier_smoothing, 1.0))
        if smoothing <= 0:
            return [
                (
                    start[0] + dx * index / steps,
                    start[1] + dy * index / steps,
                )
                for index in range(1, steps + 1)
            ]

        normal_x = -dy / distance
        normal_y = dx / distance
        bend = distance * 0.16 * smoothing
        control_1 = (
            start[0] + dx * 0.33 + normal_x * bend,
            start[1] + dy * 0.33 + normal_y * bend,
        )
        control_2 = (
            start[0] + dx * 0.66 - normal_x * bend * 0.75,
            start[1] + dy * 0.66 - normal_y * bend * 0.75,
        )

        path: list[tuple[float, float]] = []
        for index in range(1, steps + 1):
            t = index / steps
            omt = 1.0 - t
            x = (
                omt**3 * start[0]
                + 3 * omt**2 * t * control_1[0]
                + 3 * omt * t**2 * control_2[0]
                + t**3 * end[0]
            )
            y = (
                omt**3 * start[1]
                + 3 * omt**2 * t * control_1[1]
                + 3 * omt * t**2 * control_2[1]
                + t**3 * end[1]
            )
            path.append((x, y))
        return path

    def _is_ignored_window(self, name: str) -> bool:
        lowered = name.lower()
        return any(token in lowered for token in ("akagi-ng", "akagi ng", "dashboard", "hud"))
