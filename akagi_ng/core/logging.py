from datetime import datetime

from loguru import logger

from core.context import ensure_dir, get_logs_dir

LOG_DIR = ensure_dir(get_logs_dir())

log_file = LOG_DIR / f"akagi_{datetime.now():%Y%m%d_%H%M%S}.log"

logger.remove()
logger.add(
    log_file,
    level="DEBUG",
    format=(
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level}</level> | "
        "{extra[module]} | "
        "{message}"
    ),
    enqueue=True,  # 多线程安全，Playwright 会用到
)

__all__ = ["logger"]
