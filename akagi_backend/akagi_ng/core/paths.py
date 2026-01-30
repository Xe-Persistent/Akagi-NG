import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_app_root() -> Path:
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            return Path(sys._MEIPASS)
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[3]


@lru_cache(maxsize=1)
def get_runtime_root() -> Path:
    """
    Returns the root directory where runtime data (config, logs, lib, models) lives.
    - In Dev: Project Root
    - In Prod (Frozen): The application root containing the main .exe (Akagi-NG/)
    """
    if getattr(sys, "frozen", False):
        # sys.executable is Akagi-NG/bin/akagi-ng.exe
        # .parent.parent -> Akagi-NG/
        return Path(sys.executable).parent.parent
    return get_app_root()


def get_assets_dir() -> Path:
    # Assets are bundled WITH the binary via PyInstaller --datas
    return get_app_root() / "assets"


def get_settings_dir() -> Path:
    return get_runtime_root() / "config"


def get_lib_dir() -> Path:
    return get_runtime_root() / "lib"


def get_models_dir() -> Path:
    return get_runtime_root() / "models"


def get_logs_dir() -> Path:
    return get_runtime_root() / "logs"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
