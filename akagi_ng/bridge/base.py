class BaseBridge:
    def __init__(self) -> None: ...

    def parse(self, content: bytes) -> None | list[dict]:
        raise NotImplementedError

    def build(self, command: dict) -> None | bytes:
        raise NotImplementedError
