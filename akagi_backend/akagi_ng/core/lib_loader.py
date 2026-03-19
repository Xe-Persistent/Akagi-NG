import importlib.machinery
import importlib.util
import sys
from pathlib import Path

from akagi_ng.core.paths import get_lib_dir

lib_dir = get_lib_dir()
if str(lib_dir) not in sys.path:
    sys.path.insert(0, str(lib_dir))


def _candidate_paths(module_name: str) -> list[Path]:
    suffixes = importlib.machinery.EXTENSION_SUFFIXES
    paths: list[Path] = []

    for suffix in suffixes:
        direct = lib_dir / f"{module_name}{suffix}"
        if direct.exists():
            paths.append(direct)

    patterns = [
        f"{module_name}-*.pyd",
        f"{module_name}-*.so",
        f"{module_name}*.pyd",
        f"{module_name}*.so",
    ]
    for pattern in patterns:
        for path in sorted(lib_dir.glob(pattern)):
            if path not in paths:
                paths.append(path)

    return paths


def _load_extension(module_name: str):
    for path in _candidate_paths(module_name):
        loader = importlib.machinery.ExtensionFileLoader(module_name, str(path))
        spec = importlib.util.spec_from_file_location(module_name, path, loader=loader)
        if spec is None:
            continue

        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        try:
            loader.exec_module(module)
            return module
        except Exception:
            sys.modules.pop(module_name, None)

    raise ImportError(
        f"Failed to load {module_name} from {lib_dir}. Ensure a compatible .pyd/.so file is present."
    )


try:
    libriichi = _load_extension("libriichi")
    libriichi3p = _load_extension("libriichi3p")
except ImportError as e:
    raise ImportError(
        f"Failed to load libriichi/libriichi3p from {lib_dir}. Ensure the .pyd/.so files are present."
    ) from e


__all__ = ["libriichi", "libriichi3p"]
