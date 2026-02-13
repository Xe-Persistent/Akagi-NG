from akagi_ng.mjai_bot.engine.factory import load_bot_and_engine
from akagi_ng.mjai_bot.status import BotStatusContext
from akagi_ng.schema.protocols import BotProtocol, EngineProtocol


def load_model(status: BotStatusContext, seat: int) -> tuple[BotProtocol, EngineProtocol]:
    return load_bot_and_engine(status, seat, is_3p=False)
