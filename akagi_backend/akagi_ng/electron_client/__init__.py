from __future__ import annotations

import queue

from akagi_ng.core.constants import Platform
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.majsoul import MajsoulElectronClient
from akagi_ng.electron_client.tenhou import TenhouElectronClient


def create_electron_client(platform: Platform, shared_queue: queue.Queue[dict]) -> BaseElectronClient | None:
    """
    Factory function to create the appropriate ElectronClient based on the platform.

    This allows for platform-specific handling of message ingestion from Electron,
    such as decoding binary protocols (Majsoul) or parsing text protocols (Tenhou).

    Args:
        platform: The game platform
        shared_queue: Shared queue for event-driven mode
    """
    if platform == Platform.MAJSOUL:
        return MajsoulElectronClient(shared_queue=shared_queue)

    if platform == Platform.TENHOU:
        return TenhouElectronClient(shared_queue=shared_queue)

    # In AUTO mode, for now we default to Majsoul as it is the most common use case
    if platform == Platform.AUTO:
        return MajsoulElectronClient(shared_queue=shared_queue)

    # Generic or other platforms might return None if they only support MITM mode
    return None


__all__ = [
    "BaseElectronClient",
    "MajsoulElectronClient",
    "TenhouElectronClient",
    "create_electron_client",
]
