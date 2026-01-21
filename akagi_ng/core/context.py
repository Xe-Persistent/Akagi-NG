from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from akagi_ng.mitm_client import MitmClient
    from akagi_ng.mjai_bot import Controller, StateTrackerBot
    from akagi_ng.playwright_client import PlaywrightClient
    from akagi_ng.settings import Settings


@dataclass
class AppContext:
    settings: Settings
    controller: Controller | None
    bot: StateTrackerBot | None
    playwright_client: PlaywrightClient | None
    mitm_client: MitmClient | None


app: AppContext
