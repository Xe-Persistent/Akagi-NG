from importlib.metadata import version

try:
    AKAGI_VERSION = version("akagi_ng")
except Exception:
    # If package is not installed (e.g. dev mode without -e .), try reading pyproject.toml
    # or default to dev
    try:
        import tomllib
        from pathlib import Path

        root = Path(__file__).resolve().parents[1]
        with open(root / "pyproject.toml", "rb") as f:
            data = tomllib.load(f)
            AKAGI_VERSION = data["project"]["version"]
    except Exception:
        AKAGI_VERSION = "dev"

__version__ = AKAGI_VERSION
__all__ = ["AKAGI_VERSION", "__version__"]
