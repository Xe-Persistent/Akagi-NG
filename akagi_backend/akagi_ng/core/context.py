from __future__ import annotations

import queue
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from akagi_ng.electron_client import BaseElectronClient as ElectronClient
    from akagi_ng.mitm_client import MitmClient
    from akagi_ng.mjai_bot import Controller, StateTrackerBot
    from akagi_ng.settings import Settings


@dataclass
class AppContext:
    """Application context containing all core components."""

    settings: Settings
    controller: Controller | None
    bot: StateTrackerBot | None
    mitm_client: MitmClient | None
    electron_client: ElectronClient | None = None
    shared_queue: queue.Queue[dict] | None = None


# Global variable for application context (shared across threads)
_app_context: AppContext | None = None


def get_app_context() -> AppContext:
    """
    Get the current application context.

    Raises:
        RuntimeError: If context has not been initialized
    """
    global _app_context
    if _app_context is None:
        raise RuntimeError("Application context not initialized. Call set_app_context() first.")
    return _app_context


def set_app_context(context: AppContext) -> None:
    """Set the application context."""
    global _app_context
    _app_context = context
