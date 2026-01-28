from akagi_ng.core.paths import get_models_dir
from akagi_ng.mjai_bot.engine.akagi_ot import AkagiOTEngine
from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.mortal import load_local_mortal_engine
from akagi_ng.mjai_bot.logger import logger
from akagi_ng.mjai_bot.protocols import Bot
from akagi_ng.settings import local_settings


def load_model(seat: int, is_3p: bool) -> tuple[Bot, BaseEngine]:
    """
    Mortal 统一加载器（四麻和三麻）。
    处理：
    1. 导入正确的 libriichi 版本
    2. 加载本地模型（mortal.pth / mortal3p.pth）
    3. 检查在线模式并设置 AkagiOTEngine
    """
    # 根据模式动态导入
    if is_3p:
        from akagi_ng.core.lib_loader import libriichi3p as libriichi

        model_filename = "mortal3p.pth"
    else:
        from akagi_ng.core.lib_loader import libriichi

        model_filename = "mortal.pth"

    consts = libriichi.consts

    # 模型文件路径
    control_state_file = get_models_dir() / model_filename

    # 先尝试加载本地模型（作为主要或回退引擎）
    mortal_engine = load_local_mortal_engine(control_state_file, consts=consts, is_3p=is_3p)

    # 检查在线模式
    if local_settings.ot.online:
        logger.info(f"Online mode enabled. Initializing AkagiOTEngine ({'3P' if is_3p else '4P'}).")
        api_config = local_settings.ot

        # 传入 mortal_engine 作为回退引擎
        engine = AkagiOTEngine(
            is_3p=is_3p,
            url=api_config.server,
            api_key=api_config.api_key,
            fallback_engine=mortal_engine,
        )
        bot = libriichi.mjai.Bot(engine, seat)
        return bot, engine

    # 离线模式
    if mortal_engine is None:
        raise FileNotFoundError(f"Model file not found at {control_state_file} and online mode is not enabled.")

    bot = libriichi.mjai.Bot(mortal_engine, seat)
    return bot, mortal_engine
