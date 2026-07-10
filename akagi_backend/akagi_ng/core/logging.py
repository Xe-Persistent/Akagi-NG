import os
from datetime import datetime

from loguru import logger

from akagi_ng.core.paths import ensure_dir, get_logs_dir

LOG_FILE = get_logs_dir() / f"akagi_{datetime.now():%Y%m%d_%H%M%S}.log"

LOG_FORMAT = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | {extra[module]} | {message}"


def configure_logging(level: str = "INFO"):
    logger.remove()

    no_logs = os.environ.get("AKAGI_NO_LOGS", "").strip().lower() in {"1", "true", "yes", "on"}
    if no_logs or level.strip().upper() == "OFF":
        return

    ensure_dir(LOG_FILE.parent)
    logger.add(
        LOG_FILE,
        level=level,
        format=LOG_FORMAT,
        rotation="10 MB",  # 单文件超过 10 MB 自动分割
        retention="30 days",  # 保留 30 天的历史记录
        encoding="utf-8",
    )


configure_logging()

__all__ = ["configure_logging", "logger"]
