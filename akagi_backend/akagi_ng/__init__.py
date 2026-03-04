try:
    from akagi_ng._version import __version__ as _version
except ImportError:
    _version = "dev"


def _get_version() -> str:
    return _version


AKAGI_VERSION = _get_version()
__version__ = AKAGI_VERSION
__all__ = ["AKAGI_VERSION", "__version__"]
