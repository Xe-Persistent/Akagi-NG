from typing import Protocol


class Bot(Protocol):
    def react(self, events: str) -> str: ...
