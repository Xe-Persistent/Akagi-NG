from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from settings import Settings
    from mjai_bot.controller import Controller
    from mjai_bot.bot import AkagiBot
    from playwright_client.client import Client

settings: "Settings | None"
mjai_controller: "Controller | None"
mjai_bot: "AkagiBot | None"
playwright_client: "Client | None"


@lru_cache(maxsize=1)
def get_project_root() -> Path:
    """
    Determine the project root directory robustly.

    Strategy:
    - Walk upwards from this file and pick the first directory that looks like
      the repository root (contains pyproject.toml and akagi_ng/).
    - Fallback to the expected layout: .../akagi_ng/core/context.py -> root is 2 levels up from akagi_ng/.
    """
    here = Path(__file__).resolve()
    for p in (here.parent, *here.parents):
        if (p / "pyproject.toml").is_file() and (p / "akagi_ng").is_dir():
            return p

    # Fallback for unusual environments
    # context.py -> core -> akagi_ng -> <root>
    try:
        return here.parents[2]
    except IndexError:
        return Path.cwd().resolve()


def get_settings_dir() -> Path:
    return get_project_root() / "config"


def get_logs_dir() -> Path:
    return get_project_root() / "logs"


def get_lib_dir() -> Path:
    return get_project_root() / "lib"


def get_models_dir() -> Path:
    return get_project_root() / "models"


def get_playwright_data_dir() -> Path:
    return get_project_root() / "playwright_data"


def get_frontend_dir() -> Path:
    return get_project_root() / "akagi_frontend"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_runtime_dirs() -> None:
    ensure_dir(get_logs_dir())
    ensure_dir(get_playwright_data_dir())
    ensure_dir(get_frontend_dir())
