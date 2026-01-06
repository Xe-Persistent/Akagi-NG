from datetime import datetime

from loguru import logger

from akagi_ng.core.context import ensure_dir, get_logs_dir

LOG_DIR = ensure_dir(get_logs_dir())

log_file = LOG_DIR / f"akagi_{datetime.now():%Y%m%d_%H%M%S}.log"

LOG_FORMAT = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | {extra[module]} | {message}"


def configure_logging(level: str = "TRACE") -> None:
    logger.remove()
    logger.add(
        log_file,
        level=level,
        format=LOG_FORMAT,
        enqueue=True,  # Thread-safe, used by Playwright
    )


# Default configuration
configure_logging()

__all__ = ["logger", "configure_logging"]
