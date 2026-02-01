from akagi_ng.mjai_bot.engine import BaseEngine, load_bot_and_engine
from akagi_ng.mjai_bot.protocols import Bot


def load_model(seat: int) -> tuple[Bot, BaseEngine]:
    return load_bot_and_engine(seat, is_3p=False)
