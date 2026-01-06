import json
from typing import Protocol

from akagi_ng.mjai_bot.logger import logger
from akagi_ng.settings import local_settings


class Bot(Protocol):
    def react(self, events: str) -> str: ...


class Controller:
    def __init__(self):
        self.available_bots: list[type[Bot]] = []
        self.available_bots_names: list[str] = []
        self.bot: Bot | None = None
        self.list_available_bots()
        self.bot: Bot = self.available_bots[0]() if self.available_bots else None
        self.choose_bot_name(local_settings.model)
        self.pending_start_game_event: dict | None = None

    def list_available_bots(self) -> list[type[Bot]]:
        from akagi_ng.mjai_bot.mortal.bot import Bot as MortalBot
        from akagi_ng.mjai_bot.mortal3p.bot import Bot as Mortal3pBot

        self.available_bots = [MortalBot, Mortal3pBot]
        self.available_bots_names = ["mortal", "mortal3p"]
        return self.available_bots

    def react(self, event: dict) -> dict:
        try:
            if not self.bot:
                logger.error("No bot available")
                return {"type": "none"}

            if event["type"] == "start_game":
                self.pending_start_game_event = event
                return {"type": "none"}

            if event["type"] == "start_kyoku" and self.pending_start_game_event:
                if (
                        event["scores"][0] == 35000
                        and event["scores"][1] == 35000
                        and event["scores"][2] == 35000
                        and event["scores"][3] == 0
                ):
                    if not self.choose_bot_name("mortal3p"):
                        logger.error("Failed to switch to mortal3p bot")
                else:
                    if not self.choose_bot_name("mortal"):
                        logger.error("Failed to switch to mortal bot")
                # Fallthrough to process start_kyoku

            if self.pending_start_game_event and event["type"] != "start_kyoku":
                logger.error("Event after start_game is not start_kyoku!")
                logger.error(f"Event: {event}")
                return {"type": "none"}

            events = [event]
            if self.pending_start_game_event:
                events.insert(0, self.pending_start_game_event)
                self.pending_start_game_event = None

            ans = self.bot.react(json.dumps(events, separators=(",", ":")))
            logger.trace(f"<- {ans}")
            return json.loads(ans)

        except Exception as e:
            logger.exception(f"Controller error: {e}")
            return {"type": "none"}

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
