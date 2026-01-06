import sys

from akagi_ng.core.context import get_lib_dir

# Add lib dir to sys.path to allow importing binaries
lib_dir = get_lib_dir()
if str(lib_dir) not in sys.path:
    # Prepend to sys.path to ensure we load from here over other locations
    sys.path.insert(0, str(lib_dir))

try:
    import libriichi
    import libriichi3p
except ImportError as e:
    # If the directory exists but import fails, it might be a missing file or compatible binary
    # We re-raise to fail early if these core dependencies are missing
    raise ImportError(
        f"Failed to load libriichi/libriichi3p from {lib_dir}. Ensure the .pyd/.so files are present."
    ) from e

__all__ = ["libriichi", "libriichi3p"]
