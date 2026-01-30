from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from akagi_ng.electron_client import BaseElectronClient as ElectronClient
    from akagi_ng.mitm_client import MitmClient
    from akagi_ng.mjai_bot import Controller, StateTrackerBot
    from akagi_ng.settings import Settings


@dataclass
class AppContext:
    settings: Settings
    controller: Controller | None
    bot: StateTrackerBot | None
    mitm_client: MitmClient | None
    electron_client: ElectronClient | None = None


app: AppContext
