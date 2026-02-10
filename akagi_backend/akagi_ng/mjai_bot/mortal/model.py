from akagi_ng.core.protocols import Bot
from akagi_ng.mjai_bot.engine import BaseEngine, load_bot_and_engine


def load_model(seat: int) -> tuple[Bot, BaseEngine]:
    return load_bot_and_engine(seat, is_3p=False)
