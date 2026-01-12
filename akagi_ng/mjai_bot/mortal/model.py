from akagi_ng.mjai_bot.engine.base import BaseEngine
from akagi_ng.mjai_bot.engine.loader import load_model as _load_model
from akagi_ng.mjai_bot.mortal.logger import logger
from akagi_ng.mjai_bot.protocols import Bot


def load_model(seat: int) -> tuple[Bot, BaseEngine]:
    return _load_model(seat, is_3p=False, logger=logger)
