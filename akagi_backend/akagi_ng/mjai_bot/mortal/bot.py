from akagi_ng.mjai_bot.engine import MortalEngine
from akagi_ng.mjai_bot.mortal.base import MortalBot as BaseMortalBot
from akagi_ng.mjai_bot.status import BotStatusContext


class MortalBot(BaseMortalBot):
    def __init__(self, status: BotStatusContext, engine: MortalEngine | None = None):
        super().__init__(status=status, engine=engine, is_3p=False)


class Mortal3pBot(BaseMortalBot):
    def __init__(self, status: BotStatusContext, engine: MortalEngine | None = None):
        super().__init__(status=status, engine=engine, is_3p=True)
