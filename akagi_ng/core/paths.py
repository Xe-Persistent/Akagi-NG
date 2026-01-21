import os
import sys
from functools import lru_cache
from pathlib import Path


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


def ensure_runtime_dirs():
    ensure_dir(get_lib_dir())
    ensure_dir(get_models_dir())
    ensure_dir(get_playwright_data_dir())


def configure_playwright_env():
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS if hasattr(sys, "_MEIPASS") else os.path.dirname(sys.executable)
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(base, "ms-playwright")
