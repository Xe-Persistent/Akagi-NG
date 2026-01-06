from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path


def init_context() -> None:
    global settings, mjai_controller, mjai_bot, playwright_client
    settings = None
    mjai_controller = None
    mjai_bot = None
    playwright_client = None


@lru_cache(maxsize=1)
def get_app_root() -> Path:
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            return Path(sys._MEIPASS)
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def get_runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return get_app_root()


def get_assets_dir() -> Path:
    return get_app_root() / "assets"


def get_frontend_dir() -> Path:
    return get_app_root() / "frontend"


def get_settings_dir() -> Path:
    return get_runtime_root() / "config"


def get_lib_dir() -> Path:
    return get_runtime_root() / "lib"


def get_models_dir() -> Path:
    return get_runtime_root() / "models"


def get_logs_dir() -> Path:
    return get_runtime_root() / "logs"


def get_playwright_data_dir() -> Path:
    return get_runtime_root() / "playwright_data"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_runtime_dirs() -> None:
    ensure_dir(get_lib_dir())
    ensure_dir(get_models_dir())
    ensure_dir(get_playwright_data_dir())
