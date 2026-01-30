from dataclasses import dataclass, field
from typing import Any


@dataclass
class State:
    """Tenhou Bridge State"""

    game_active: bool = False
    seat: int = 0
    is_3p: bool = False
    hand: list[int] = field(default_factory=list)
    in_riichi: bool = False
    live_wall: int = 70
    melds: list[Any] = field(default_factory=list)
    wait: list[str] = field(default_factory=list)
    last_kawa_tile: str = "?"
    is_tsumo: bool = False
    is_new_round: bool = False
