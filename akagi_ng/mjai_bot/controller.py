import json
from typing import Protocol

from settings.settings import settings
from .logger import logger


class Bot(Protocol):
    def react(self, events: str) -> str:
        ...


class Controller(object):
    def __init__(self):
        self.available_bots: list[type[Bot]] = []
        self.available_bots_names: list[str] = []
        self.bot: Bot | None = None
        self.list_available_bots()
        self.bot: Bot = self.available_bots[0]() if self.available_bots else None
        self.choose_bot_name(settings.model)
        self.temp_mjai_msg: list[dict] = []
        self.starting_game: bool = False

    def list_available_bots(self) -> list[type[Bot]]:
        from mjai_bot.mortal.bot import Bot as MortalBot
        from mjai_bot.mortal3p.bot import Bot as Mortal3pBot

        self.available_bots = [MortalBot, Mortal3pBot]
        self.available_bots_names = ["mortal", "mortal3p"]
        return self.available_bots

    def react(self, events: list[dict]) -> dict:
        if not self.bot:
            logger.error("No bot available")
            return {"type": "none"}
        for event in events:
            if event["type"] == "start_game":
                self.starting_game = True
                self.temp_mjai_msg = []
                self.temp_mjai_msg.append(event)
                continue
            if event["type"] == "start_kyoku" and self.starting_game:
                self.starting_game = False
                if (
                        event["scores"][0] == 35000 and
                        event["scores"][1] == 35000 and
                        event["scores"][2] == 35000 and
                        event["scores"][3] == 0
                ):
                    if not self.choose_bot_name("mortal3p"):
                        logger.error("Failed to switch to mortal3p bot")
                else:
                    if not self.choose_bot_name("mortal"):
                        logger.error("Failed to switch to mortal bot")
                continue
            if self.starting_game:
                logger.error("Event after start_game is not start_kyoku!")
                logger.error(f"Event: {event}")
                continue
        if self.starting_game:
            return {"type": "none"}
        events = self.temp_mjai_msg + events
        self.temp_mjai_msg = []
        ans = self.bot.react(json.dumps(events, separators=(",", ":")))
        return json.loads(ans)

    def choose_bot_index(self, bot_index: int) -> bool:
        if 0 <= bot_index < len(self.available_bots):
            self.bot = self.available_bots[bot_index]()
            return True
        return False

    def choose_bot_name(self, bot_name: str) -> bool:
        if bot_name in self.available_bots_names:
            index = self.available_bots_names.index(bot_name)
            self.bot = self.available_bots[index]()
            return True
        return False
