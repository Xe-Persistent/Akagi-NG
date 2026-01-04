from datetime import datetime

from loguru import logger

from core.context import ensure_dir, get_logs_dir

LOG_DIR = ensure_dir(get_logs_dir())

log_file = LOG_DIR / f"akagi_{datetime.now():%Y%m%d_%H%M%S}.log"

LOG_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level}</level> | "
    "{extra[module]} | "
    "{message}"
)


def configure_logging(level: str = "TRACE") -> None:
    logger.remove()
    logger.add(
        log_file,
        level=level,
        format=LOG_FORMAT,
        enqueue=True,  # 多线程安全，Playwright 会用到
    )


# Default configuration
configure_logging()

__all__ = ["logger", "configure_logging"]
