/**
 * 通知代码常量定义。
 */
export enum NotificationCode {
  // 游戏事件通知
  CLIENT_CONNECTED = 'client_connected',
  GAME_CONNECTED = 'game_connected',
  GAME_SYNCING = 'game_syncing',
  GAME_DISCONNECTED = 'game_disconnected',
  RETURN_LOBBY = 'return_lobby',

  // 数据处理错误
  PARSE_ERROR = 'game_data_parse_failed',

  // 引擎错误
  MODEL_LOADED_LOCAL = 'model_loaded_local',
  MODEL_LOAD_FAILED = 'model_load_failed',
  BOT_RUNTIME_ERROR = 'bot_runtime_error',
}

export type Actor = number;
export type Tile = string;
export type Score = number;

export interface MJAIEventBase {
  type: string;
  sync?: boolean;
}

export interface StartGameEvent extends MJAIEventBase {
  type: 'start_game';
  id: Actor;
  is_3p: boolean;
}

export interface StartKyokuEvent extends MJAIEventBase {
  type: 'start_kyoku';
  bakaze: Tile;
  dora_marker: Tile;
  kyoku: number;
  honba: number;
  kyotaku: number;
  oya: Actor;
  scores: Score[];
  tehais: Tile[][];
}

export interface TsumoEvent extends MJAIEventBase {
  type: 'tsumo';
  actor: Actor;
  pai: Tile;
}

export interface DahaiEvent extends MJAIEventBase {
  type: 'dahai';
  actor: Actor;
  pai: Tile;
  tsumogiri: boolean;
}

export interface ChiEvent extends MJAIEventBase {
  type: 'chi';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface PonEvent extends MJAIEventBase {
  type: 'pon';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface DaiminkanEvent extends MJAIEventBase {
  type: 'daiminkan';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface AnkanEvent extends MJAIEventBase {
  type: 'ankan';
  actor: Actor;
  consumed: Tile[];
}

export interface KakanEvent extends MJAIEventBase {
  type: 'kakan';
  actor: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface ReachEvent extends MJAIEventBase {
  type: 'reach';
  actor: Actor;
}

export interface ReachAcceptedEvent extends MJAIEventBase {
  type: 'reach_accepted';
  actor: Actor;
  scores?: Score[];
  deltas?: Score[];
}

export interface DoraEvent extends MJAIEventBase {
  type: 'dora';
  dora_marker: Tile;
}

export interface NukidoraEvent extends MJAIEventBase {
  type: 'nukidora';
  actor: Actor;
  pai: 'N';
}

export interface EndKyokuEvent extends MJAIEventBase {
  type: 'end_kyoku';
}

export interface HoraEvent extends MJAIEventBase {
  type: 'hora';
  actor: Actor;
  target: Actor;
  pai: Tile;
  scores: Score[];
  deltas: Score[];
  ba?: number;
  kyoku?: number;
  honba?: number;
  kyotaku?: number;
  ura_dora_markers?: Tile[];
  hand?: Tile[];
  fu?: number;
  fan?: number;
  yaku?: string[];
}

export interface RyukyokuEvent extends MJAIEventBase {
  type: 'ryukyoku';
  scores: Score[];
  reason?: string;
  deltas?: Score[];
  tehais?: Tile[][];
  tenpais?: boolean[];
}

export interface EndGameEvent extends MJAIEventBase {
  type: 'end_game';
}

export interface SystemEvent {
  type: 'system_event';
  code: NotificationCode;
}

export interface SystemShutdownEvent {
  type: 'system_shutdown';
}

export type MJAIEvent =
  | StartGameEvent
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
  | EndGameEvent;

export type AkagiEvent = MJAIEvent | SystemEvent | SystemShutdownEvent;

// We also have Electron messages sent to the ingest
export interface WebSocketCreatedMessage {
  type: 'websocket_created';
  url: string;
}

export interface WebSocketClosedMessage {
  type: 'websocket_closed';
}

export interface WebSocketFrameMessage {
  type: 'websocket';
  direction: 'inbound' | 'outbound';
  data: string;
  opcode?: number;
}

export interface DebuggerDetachedMessage {
  type: 'debugger_detached';
}

export type ElectronMessage =
  | WebSocketCreatedMessage
  | WebSocketClosedMessage
  | WebSocketFrameMessage
  | DebuggerDetachedMessage
  | AkagiEvent;
