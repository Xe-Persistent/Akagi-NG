from functools import cache
from pathlib import Path


@cache
def get_app_root() -> Path:
    """
    动态推导项目根目录。
    """
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "assets").is_dir():
            return parent

    # 极端异常场景的回退保障（按照开发源目录推三层）
    return current.parents[3]


def get_assets_dir() -> Path:
    return get_app_root() / "assets"


def get_settings_dir() -> Path:
    return get_app_root() / "config"


def get_lib_dir() -> Path:
    return get_app_root() / "lib"


def get_models_dir() -> Path:
    return get_app_root() / "models"


def get_logs_dir() -> Path:
    return get_app_root() / "logs"


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
