from akagi_ng.mjai_bot.engine import BaseEngine
from akagi_ng.mjai_bot.engine import load_model as _load_model
from akagi_ng.mjai_bot.protocols import Bot


def load_model(seat: int) -> tuple[Bot, BaseEngine]:
    return _load_model(seat, is_3p=False)
