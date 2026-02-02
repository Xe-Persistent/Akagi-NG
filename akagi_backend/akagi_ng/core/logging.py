import os
import sys
from datetime import datetime

from loguru import logger

from akagi_ng.core.paths import ensure_dir, get_logs_dir

LOG_DIR = ensure_dir(get_logs_dir())

log_file = LOG_DIR / f"akagi_{datetime.now():%Y%m%d_%H%M%S}.log"

LOG_FORMAT = "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level}</level> | {extra[module]} | {message}"


def configure_logging(level: str = "INFO"):
    """配置日志系统

    日志行为说明:
    - 所有模式下都会输出到日志文件 (持久化存储)
    - GUI 模式 (AKAGI_GUI_MODE=1): 同时输出到 stdout,供 Electron 捕获显示
    - 非 GUI 模式 (直接运行/生产环境): 仅输出到文件,不影响 stdout/stderr

    这样设计的好处:
    1. 生产环境不受影响,日志仅写入文件
    2. Electron 环境可以实时捕获日志,包括退出日志
    3. 遵循 Unix 惯例: stdout 用于正常输出,stderr 用于错误
    4. 开发调试时可以通过设置环境变量来控制行为
    """
    logger.remove()

    # 始终输出到文件 (所有环境)
    logger.add(
        log_file,
        level=level,
        format=LOG_FORMAT,
    )

    # 仅在 GUI 模式下输出到 stdout (供 Electron 捕获)
    # 使用 stdout 而不是 stderr,因为这些是正常的日志输出,不是错误
    # 生产环境或直接运行时不会设置此环境变量,因此不会输出到 stdout
    if os.getenv("AKAGI_GUI_MODE") == "1":
        logger.add(
            sys.stdout,
            level=level,
            format=LOG_FORMAT,
        )


configure_logging()

__all__ = ["configure_logging", "logger"]
