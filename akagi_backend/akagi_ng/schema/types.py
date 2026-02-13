import asyncio
from typing import Literal, NotRequired, Self, TypedDict

from aiohttp import web

from akagi_ng.schema.notifications import NotificationCode

EngineType = Literal["mortal", "akagiot", "replay", "unknown", "null"]


class MJAIMetadata(TypedDict, total=False):
    """MJAI 协议响应中的元数据字段 (meta)。"""

    # 核心推理预测
    q_values: list[float]
    mask_bits: int
    is_greedy: bool
    batch_size: int
    eval_time_ns: int

    # C++ 注入数据 (来自 libriichi)
    shanten: int
    at_furiten: bool

    # 业务层注入数据
    engine_type: str
    fallback_used: bool
    online_service_reconnecting: bool
    game_start: bool

    # 嵌套前瞻结果
    riichi_lookahead: Self


class MJAIResponse(TypedDict, total=False):
    """MJAI 协议响应格式"""

    type: str
    meta: MJAIMetadata
    # 其他可能的响应字段
    actor: int
    pai: str
    consumed: list[str]
    target: int


class NotificationFlags(TypedDict, total=False):
    """Bot 与引擎通知标志 - 用于前端 Toast/Alert 显示"""

    # 引擎层状态
    fallback_used: bool  # 是否使用了回转引擎
    online_service_reconnecting: bool  # 熔断器是否打开 (正在重连)
    online_service_restored: bool  # 熔断器是否已恢复
    no_bot_loaded: bool  # 是否无可用引擎
    model_loaded_local: bool  # 本地模型已加载
    model_loaded_online: bool  # 在线模型已加载
    riichi_simulation_failed: bool  # 立直前瞻模拟是否失败

    # 逻辑层与生命周期状态
    bot_runtime_error: bool  # Bot 运行时发生未捕获异常
    state_tracker_error: bool  # 状态跟踪器异常
    bot_switch_failed: bool  # Bot 切换失败
    model_load_failed: bool  # 模型加载失败

    # 游戏生命周期与错误
    game_connected: bool  # 游戏已连接
    game_data_parse_failed: bool  # 解析错误


class EngineAdditionalMeta(TypedDict, total=False):
    """引擎附加元数据 - 用于合并到推理响应响应中"""

    engine_type: EngineType
    online_service_reconnecting: bool
    fallback_used: bool
    no_bot_loaded: bool


type NotificationFlagKey = NotificationCode

type EngineAdditionalMetaKey = NotificationCode


class Notification(TypedDict):
    """前端通知对象"""

    code: str


class FuuroDetail(TypedDict):
    """副露详情 (吃、碰、杠)"""

    tile: str
    consumed: list[str]


class ProcessResult(TypedDict):
    """MJAI 消息批次处理结果"""

    mjai_responses: list[MJAIResponse]
    batch_notifications: list[Notification]
    is_sync: bool


class SimCandidate(TypedDict):
    """立直模拟候选 (对应前端 SimCandidate)"""

    tile: str
    confidence: float


class Recommendation(TypedDict):
    """DataServer 推荐项 (对应前端 Recommendation)"""

    action: str
    confidence: float
    tile: NotRequired[str]
    consumed: NotRequired[list[str]]
    sim_candidates: NotRequired[list[SimCandidate]]


class FullRecommendationData(TypedDict, total=False):
    """完整推荐数据载荷 (对应前端 FullRecommendationData)"""

    recommendations: list[Recommendation]
    engine_type: NotRequired[str | None]
    fallback_used: NotRequired[bool | None]
    circuit_open: NotRequired[bool | None]


class SSEClientData(TypedDict):
    """SSE 客户端数据"""

    # 由于 aiohttp.web.StreamResponse 和 asyncio.Queue 是运行时对象，
    # 这里保持 TypedDict 的类型提示作用，但不强制类型检查
    response: web.StreamResponse
    queue: asyncio.Queue


# ==========================================================
# MJAI Protocol Events


class MJAIEventBase(TypedDict):
    """MJAI 协议事件基类"""

    type: str
    sync: NotRequired[bool]


class StartGameEvent(MJAIEventBase):
    type: Literal["start_game"]
    id: int
    is_3p: bool


class StartKyokuEvent(MJAIEventBase):
    type: Literal["start_kyoku"]
    bakaze: str
    dora_marker: str
    kyoku: int
    honba: int
    kyotaku: int
    oya: int
    scores: list[int]
    tehais: list[list[str]]


class TsumoEvent(MJAIEventBase):
    type: Literal["tsumo"]
    actor: int
    pai: str


class DahaiEvent(MJAIEventBase):
    type: Literal["dahai"]
    actor: int
    pai: str
    tsumogiri: bool


class ChiEvent(MJAIEventBase):
    type: Literal["chi"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class PonEvent(MJAIEventBase):
    type: Literal["pon"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class DaiminkanEvent(MJAIEventBase):
    type: Literal["daiminkan"]
    actor: int
    target: int
    pai: str
    consumed: list[str]


class AnkanEvent(MJAIEventBase):
    type: Literal["ankan"]
    actor: int
    consumed: list[str]


class KakanEvent(MJAIEventBase):
    type: Literal["kakan"]
    actor: int
    pai: str
    consumed: list[str]


class ReachEvent(MJAIEventBase):
    type: Literal["reach"]
    actor: int


class ReachAcceptedEvent(MJAIEventBase):
    type: Literal["reach_accepted"]
    actor: int
    scores: NotRequired[list[int]]
    deltas: NotRequired[list[int]]


class DoraEvent(MJAIEventBase):
    type: Literal["dora"]
    dora_marker: str


class NukidoraEvent(MJAIEventBase):
    type: Literal["nukidora"]
    actor: int
    pai: Literal["N"]


class EndKyokuEvent(MJAIEventBase):
    type: Literal["end_kyoku"]


class RyukyokuEvent(MJAIEventBase):
    type: Literal["ryukyoku"]
    scores: list[int]


class EndGameEvent(MJAIEventBase):
    type: Literal["end_game"]


class SystemEvent(MJAIEventBase):
    type: Literal["system_event"]
    code: str
    msg: NotRequired[str]


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
    | RyukyokuEvent
    | EndGameEvent
)


type AkagiEvent = MJAIEvent | SystemEvent


# ==========================================================
# Electron IPC 消息定义 (CDP / WebSocket 帧)


class WebSocketCreatedMessage(TypedDict):
    type: Literal["websocket_created"]
    url: str


class WebSocketClosedMessage(TypedDict):
    type: Literal["websocket_closed"]


class WebSocketFrameMessage(TypedDict):
    type: Literal["websocket"]
    direction: Literal["inbound", "outbound"]
    data: str
    opcode: NotRequired[int]


class LiqiDefinitionMessage(TypedDict):
    type: Literal["liqi_definition"]
    data: str


class DebuggerDetachedMessage(TypedDict):
    type: Literal["debugger_detached"]


type ElectronMessage = (
    WebSocketCreatedMessage
    | WebSocketClosedMessage
    | WebSocketFrameMessage
    | LiqiDefinitionMessage
    | DebuggerDetachedMessage
)
