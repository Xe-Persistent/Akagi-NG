import asyncio
from dataclasses import dataclass
from typing import Annotated, Literal, NamedTuple, NotRequired, Self, TypedDict

from aiohttp import web

from akagi_ng.schema.notifications import NotificationCode

# ==========================================================
# 业务类型


type EngineType = Literal["mortal", "akagiapi", "akagiot", "unknown", "null"]


class ApiCandidate(TypedDict):
    """One ranked coarse action returned by Akagi's V3 API."""

    action: str
    prob: float


class EngineAdditionalMeta(TypedDict, total=False):
    """引擎附加元数据 - 用于合并到推理响应响应中"""

    engine_type: EngineType
    online_service_reconnecting: bool
    fallback_used: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class MortalModelResource:
    """
    持有 Mortal 模型核心资源的容器。
    这些资源在多个 Bot 实例间共享，以减少内存占用。
    """

    brain: object
    dqn: object
    version: int
    device: object
    stochastic_latent: bool
    boltzmann_epsilon: float
    boltzmann_temp: float
    top_p: float
    engine_name: str


# --- 引擎与通知精确类型定义 ---
# 根据逻辑分类：Flag (持久状态标志) vs Event (瞬时系统事件)

# 1. 标志类 (用于 NotificationFlags)
type NotificationFlagKey = Literal[
    NotificationCode.FALLBACK_USED,
    NotificationCode.RECONNECTING,
    NotificationCode.SERVICE_RESTORED,
    NotificationCode.NO_BOT_LOADED,
    NotificationCode.MODEL_LOADED_LOCAL,
    NotificationCode.MODEL_LOADED_ONLINE,
    NotificationCode.RIICHI_SIM_FAILED,
    NotificationCode.BOT_RUNTIME_ERROR,
    NotificationCode.STATE_TRACKER_ERROR,
    NotificationCode.BOT_SWITCH_FAILED,
    NotificationCode.MODEL_LOAD_FAILED,
    NotificationCode.GAME_CONNECTED,
    NotificationCode.JSON_DECODE_ERROR,
]
type NotificationFlags = set[NotificationFlagKey]

# 2. 元数据键 (用于推理响应注入)
type EngineAdditionalMetaKey = Literal[
    NotificationCode.ENGINE_TYPE,
    NotificationCode.RECONNECTING,
    NotificationCode.FALLBACK_USED,
]

# 3. 系统事件类 (用于 SystemEvent.code)
type SystemEventCode = Literal[
    NotificationCode.CLIENT_CONNECTED,
    NotificationCode.GAME_CONNECTED,
    NotificationCode.GAME_SYNCING,
    NotificationCode.GAME_DISCONNECTED,
    NotificationCode.RETURN_LOBBY,
    NotificationCode.PARSE_ERROR,
    NotificationCode.JSON_DECODE_ERROR,
]


# --- 领域语义化类型别名 ---
type Actor = Annotated[int, "Player index (0-3)"]
type Tile = Annotated[str, "MJAI tile string (e.g., '1m', '5mr', 'E')"]
type Score = Annotated[int, "Player score (e.g., 25000)"]

# MJAI 动作类型 (用于响应和推荐)
type MJAIActionType = Literal[
    "none",
    "dahai",
    "reach",
    "chi",
    "pon",
    "daiminkan",
    "ankan",
    "kakan",
    "nukidora",
    "tsumo",
    "hora",
    "ryukyoku",
]

type ChiType = Literal["chi_low", "chi_mid", "chi_high"]
type FuuroAction = Literal["chi_low", "chi_mid", "chi_high", "pon", "kan_select"]


class MJAIMetadata(TypedDict, total=False):
    """MJAI 协议响应中的元数据字段 (meta)。"""

    # 引擎层预测细节
    q_values: list[float]
    mask_bits: int
    is_greedy: bool
    batch_size: int
    eval_time_ns: int

    # C++ 状态导出 (来自 libriichi.PlayerState)
    shanten: int
    waits: list[int]
    at_furiten: bool

    # 业务逻辑注入
    engine_type: EngineType
    fallback_used: bool
    online_service_reconnecting: bool  # 熔断器状态
    api_candidates: list[ApiCandidate]
    api_reach_candidates: list[ApiCandidate]
    api_model: str

    # 嵌套前瞻结果
    riichi_lookahead: Self


class MJAIResponse(TypedDict):
    """MJAI 协议响应格式"""

    type: MJAIActionType  # 动作类型
    actor: NotRequired[Actor]  # 注意：none 动作可能没有 actor
    pai: NotRequired[Tile]
    tsumogiri: NotRequired[bool]
    consumed: NotRequired[list[Tile]]
    target: NotRequired[Actor]
    meta: NotRequired[MJAIMetadata]


class FuuroDetail(TypedDict):
    """副露详情 (吃、碰、杠)"""

    tile: Tile
    consumed: list[Tile]


class SimCandidate(TypedDict):
    """立直模拟候选 (对应前端 SimCandidate)"""

    tile: Tile
    confidence: float


class Recommendation(TypedDict):
    """DataServer 推荐项 (对应前端 Recommendation)"""

    action: str
    confidence: float
    tile: NotRequired[Tile]
    consumed: NotRequired[list[Tile]]
    sim_candidates: NotRequired[list[SimCandidate]]


class FullRecommendationData(TypedDict):
    """完整推荐数据载荷 (对应前端 FullRecommendationData)"""

    recommendations: list[Recommendation]
    engine_type: EngineType
    fallback_used: bool
    circuit_open: bool


class Notification(TypedDict):
    """前端通知对象"""

    code: NotificationCode


class ProcessResult(NamedTuple):
    """MJAI 单条消息处理结果"""

    response: MJAIResponse | None
    notifications: list[Notification]
    is_sync: bool


class SSEClientData(NamedTuple):
    """SSE 客户端数据"""

    response: web.StreamResponse
    queue: asyncio.Queue[bytes]


# ==========================================================
# MJAI 协议事件


@dataclass(frozen=True, slots=True, kw_only=True)
class MJAIEventBase:
    """MJAI 协议事件基类"""

    type: str
    sync: bool = False


@dataclass(frozen=True, slots=True, kw_only=True)
class StartGameEvent(MJAIEventBase):
    id: Actor
    is_3p: bool
    type: Literal["start_game"] = "start_game"


@dataclass(frozen=True, slots=True, kw_only=True)
class StartKyokuEvent(MJAIEventBase):
    bakaze: Tile
    dora_marker: Tile
    kyoku: int
    honba: int
    kyotaku: int
    oya: Actor
    scores: list[Score]
    tehais: list[list[Tile]]
    type: Literal["start_kyoku"] = "start_kyoku"


@dataclass(frozen=True, slots=True, kw_only=True)
class TsumoEvent(MJAIEventBase):
    actor: Actor
    pai: Tile
    type: Literal["tsumo"] = "tsumo"


@dataclass(frozen=True, slots=True, kw_only=True)
class DahaiEvent(MJAIEventBase):
    actor: Actor
    pai: Tile
    tsumogiri: bool
    type: Literal["dahai"] = "dahai"


@dataclass(frozen=True, slots=True, kw_only=True)
class ChiEvent(MJAIEventBase):
    actor: Actor
    target: Actor
    pai: Tile
    consumed: list[Tile]
    type: Literal["chi"] = "chi"


@dataclass(frozen=True, slots=True, kw_only=True)
class PonEvent(MJAIEventBase):
    actor: Actor
    target: Actor
    pai: Tile
    consumed: list[Tile]
    type: Literal["pon"] = "pon"


@dataclass(frozen=True, slots=True, kw_only=True)
class DaiminkanEvent(MJAIEventBase):
    actor: Actor
    target: Actor
    pai: Tile
    consumed: list[Tile]
    type: Literal["daiminkan"] = "daiminkan"


@dataclass(frozen=True, slots=True, kw_only=True)
class AnkanEvent(MJAIEventBase):
    actor: Actor
    consumed: list[Tile]
    type: Literal["ankan"] = "ankan"


@dataclass(frozen=True, slots=True, kw_only=True)
class KakanEvent(MJAIEventBase):
    actor: Actor
    pai: Tile
    consumed: list[Tile]
    type: Literal["kakan"] = "kakan"


@dataclass(frozen=True, slots=True, kw_only=True)
class ReachEvent(MJAIEventBase):
    actor: Actor
    type: Literal["reach"] = "reach"


@dataclass(frozen=True, slots=True, kw_only=True)
class ReachAcceptedEvent(MJAIEventBase):
    actor: Actor
    scores: list[Score] | None = None
    deltas: list[Score] | None = None
    type: Literal["reach_accepted"] = "reach_accepted"


@dataclass(frozen=True, slots=True, kw_only=True)
class DoraEvent(MJAIEventBase):
    dora_marker: Tile
    type: Literal["dora"] = "dora"


@dataclass(frozen=True, slots=True, kw_only=True)
class NukidoraEvent(MJAIEventBase):
    actor: Actor
    pai: Literal["N"] = "N"
    type: Literal["nukidora"] = "nukidora"


@dataclass(frozen=True, slots=True, kw_only=True)
class EndKyokuEvent(MJAIEventBase):
    type: Literal["end_kyoku"] = "end_kyoku"


@dataclass(frozen=True, slots=True, kw_only=True)
class HoraEvent(MJAIEventBase):
    actor: Actor
    target: Actor
    pai: Tile
    scores: list[Score]
    deltas: list[Score]
    ba: int | None = None
    kyoku: int | None = None
    honba: int | None = None
    kyotaku: int | None = None
    ura_dora_markers: list[Tile] | None = None
    hand: list[Tile] | None = None
    fu: int | None = None
    fan: int | None = None
    yaku: list[str] | None = None
    type: Literal["hora"] = "hora"


@dataclass(frozen=True, slots=True, kw_only=True)
class RyukyokuEvent(MJAIEventBase):
    scores: list[Score]
    reason: str | None = None
    deltas: list[Score] | None = None
    tehais: list[list[Tile]] | None = None
    tenpais: list[bool] | None = None
    type: Literal["ryukyoku"] = "ryukyoku"


@dataclass(frozen=True, slots=True, kw_only=True)
class EndGameEvent(MJAIEventBase):
    type: Literal["end_game"] = "end_game"


@dataclass(frozen=True, slots=True, kw_only=True)
class SystemEvent:
    code: SystemEventCode
    type: Literal["system_event"] = "system_event"


@dataclass(frozen=True, slots=True, kw_only=True)
class SystemShutdownEvent:
    type: Literal["system_shutdown"] = "system_shutdown"


type MJAIEvent = (
    StartGameEvent
    | StartKyokuEvent
    | TsumoEvent
    | DahaiEvent
    | ChiEvent
    | PonEvent
    | DaiminkanEvent
    | AnkanEvent
    | KakanEvent
    | ReachEvent
    | ReachAcceptedEvent
    | DoraEvent
    | NukidoraEvent
    | EndKyokuEvent
    | HoraEvent
    | RyukyokuEvent
    | EndGameEvent
)


type AkagiEvent = MJAIEvent | SystemEvent | SystemShutdownEvent


# ==========================================================
# Electron IPC 消息定义 (CDP / WebSocket 帧)


@dataclass(frozen=True, slots=True, kw_only=True)
class WebSocketCreatedMessage:
    url: str
    type: str = "websocket_created"


@dataclass(frozen=True, slots=True, kw_only=True)
class WebSocketClosedMessage:
    type: str = "websocket_closed"


@dataclass(frozen=True, slots=True, kw_only=True)
class WebSocketFrameMessage:
    direction: Literal["inbound", "outbound"]
    data: str
    opcode: int | None = None
    type: str = "websocket"


@dataclass(frozen=True, slots=True, kw_only=True)
class DebuggerDetachedMessage:
    type: str = "debugger_detached"


type ElectronMessage = (
    WebSocketCreatedMessage | WebSocketClosedMessage | WebSocketFrameMessage | DebuggerDetachedMessage
)
