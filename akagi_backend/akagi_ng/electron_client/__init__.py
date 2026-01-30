from __future__ import annotations

from akagi_ng.core.constants import Platform
from akagi_ng.electron_client.base import BaseElectronClient
from akagi_ng.electron_client.majsoul import MajsoulElectronClient
from akagi_ng.electron_client.tenhou import TenhouElectronClient


def create_electron_client(platform: Platform) -> BaseElectronClient | None:
    """
    Factory function to create the appropriate ElectronClient based on the platform.

    This allows for platform-specific handling of message ingestion from Electron,
    such as decoding binary protocols (Majsoul) or parsing text protocols (Tenhou).
    """
    if platform == Platform.MAJSOUL:
        return MajsoulElectronClient()

    if platform == Platform.TENHOU:
        return TenhouElectronClient()

    # In AUTO mode, for now we default to Majsoul as it is the most common use case
    if platform == Platform.AUTO:
        return MajsoulElectronClient()

    # Generic or other platforms might return None if they only support MITM mode
    return None


__all__ = [
    "BaseElectronClient",
    "MajsoulElectronClient",
    "TenhouElectronClient",
    "create_electron_client",
]
