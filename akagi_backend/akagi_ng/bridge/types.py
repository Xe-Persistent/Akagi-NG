from typing import Literal, NotRequired, TypedDict


class MJAIEvent(TypedDict):
    """MJAI 协议事件基类"""

    type: str


class StartGameEvent(MJAIEvent):
    type: Literal["start_game"]
    id: int


class StartKyokuEvent(MJAIEvent):
    type: Literal["start_kyoku"]
    bakaze: str
    dora_marker: str
    kyoku: int
    honba: int
    kyotaku: int
    oya: int
    scores: list[int]
    tehais: list[list[str]]


class TsumoEvent(MJAIEvent):
    type: Literal["tsumo"]
    actor: int
    pai: str


class DahaiEvent(MJAIEvent):
    type: Literal["dahai"]
    actor: int
    pai: str
    tsumogiri: bool


class ChiEvent(MJAIEvent):
    type: Literal["chi"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class PonEvent(MJAIEvent):
    type: Literal["pon"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class DaiminkanEvent(MJAIEvent):
    type: Literal["daiminkan"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class AnkanEvent(MJAIEvent):
    type: Literal["ankan"]
    actor: int
    consumed: list[str]


class KakanEvent(MJAIEvent):
    type: Literal["kakan"]
    actor: int
    pai: str
    consumed: list[str]


class ReachEvent(MJAIEvent):
    type: Literal["reach"]
    actor: int


class ReachAcceptedEvent(MJAIEvent):
    type: Literal["reach_accepted"]
    actor: int
    scores: NotRequired[list[int]]
    deltas: NotRequired[list[int]]


class DoraEvent(MJAIEvent):
    type: Literal["dora"]
    dora_marker: str


class NukidoraEvent(MJAIEvent):
    type: Literal["nukidora"]
    actor: int
    pai: Literal["N"]


class EndKyokuEvent(MJAIEvent):
    type: Literal["end_kyoku"]


class RyukyokuEvent(MJAIEvent):
    type: Literal["ryukyoku"]
    scores: list[int]


class EndGameEvent(MJAIEvent):
    type: Literal["end_game"]


class SystemEvent(MJAIEvent):
    type: Literal["system_event"]
    code: str
    msg: NotRequired[str]
