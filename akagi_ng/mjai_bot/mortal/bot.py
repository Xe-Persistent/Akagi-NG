from akagi_ng.mjai_bot.engine import MortalEngine
from akagi_ng.mjai_bot.mortal.base import MortalBot as BaseMortalBot


class MortalBot(BaseMortalBot):
    def __init__(self, engine: MortalEngine | None = None):
        super().__init__(engine, is_3p=False)


class Mortal3pBot(BaseMortalBot):
    def __init__(self, engine: MortalEngine | None = None):
        super().__init__(engine, is_3p=True)
