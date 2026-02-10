import queue
from dataclasses import dataclass

from akagi_ng.core.protocols import Bot, ControllerProtocol, ElectronClientProtocol, MessageSource
from akagi_ng.settings import Settings


@dataclass
class AppContext:
    """Application context containing all core components."""

    settings: Settings
    shared_queue: queue.Queue[dict]
    controller: ControllerProtocol | None
    bot: Bot | None
    mitm_client: MessageSource | None
    electron_client: ElectronClientProtocol | None = None


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
