import contextlib
import sys
from pathlib import Path


def _get_version() -> str:
    with contextlib.suppress(Exception):
        root = Path(getattr(sys, "_MEIPASS", Path(__file__).parent.parent))
        pp_path = root / "pyproject.toml"

        if pp_path.exists():
            with open(pp_path, encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("version ="):
                        return line.split("=")[1].strip().strip("\"'")

    return "dev"


AKAGI_VERSION = _get_version()
__version__ = AKAGI_VERSION
__all__ = ["AKAGI_VERSION", "__version__"]
