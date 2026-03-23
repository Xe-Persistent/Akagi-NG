from __future__ import annotations

import importlib.util
import platform
import sys
from pathlib import Path
from types import ModuleType

from akagi_ng.core.paths import get_lib_dir

lib_dir = get_lib_dir()
if str(lib_dir) not in sys.path:
    sys.path.insert(0, str(lib_dir))


def _platform_suffix() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    python_version = f"{sys.version_info.major}.{sys.version_info.minor}"

    if machine in {"arm64", "aarch64"}:
        arch = "aarch64"
    else:
        arch = "x86_64"

    if system == "Windows":
        return f"{python_version}-{arch}-pc-windows-msvc.pyd"
    if system == "Darwin":
        return f"{python_version}-{arch}-apple-darwin.so"
    if system == "Linux":
        return f"{python_version}-{arch}-unknown-linux-gnu.so"
    raise ImportError(f"Unsupported platform for libriichi loading: {system}/{machine}")


def _candidate_paths(module_name: str) -> list[Path]:
    suffix = _platform_suffix()
    extension = ".pyd" if platform.system() == "Windows" else ".so"
    return [
        lib_dir / f"{module_name}{extension}",
        lib_dir / f"{module_name}-{suffix}",
    ]


def _load_extension_module(module_name: str) -> ModuleType:
    for candidate in _candidate_paths(module_name):
        if not candidate.exists():
            continue

        spec = importlib.util.spec_from_file_location(module_name, candidate)
        if spec is None or spec.loader is None:
            continue

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module

    searched = ", ".join(str(path) for path in _candidate_paths(module_name))
    raise ImportError(
        f"Failed to load {module_name} from {lib_dir}. Checked: {searched}"
    )


try:
    import libriichi  # type: ignore[no-redef]
except ImportError:
    libriichi = _load_extension_module("libriichi")

try:
    import libriichi3p  # type: ignore[no-redef]
except ImportError:
    libriichi3p = _load_extension_module("libriichi3p")


__all__ = ["libriichi", "libriichi3p"]
