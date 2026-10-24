/** mjai protocol events, as produced by the bridges and fed to the engine. */
type Actor = number;
type Tile = string;
type Score = number;

export interface StartGameEvent {
  type: 'start_game';
  /** One nickname per seat, in seat order. */
  names: string[];
  /** 3 for sanma, 4 for yonma: the mjai field that carries the table size. */
  num_players: number;
}

export interface StartKyokuEvent {
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

export interface TsumoEvent {
  type: 'tsumo';
  actor: Actor;
  pai: Tile;
}

export interface DahaiEvent {
  type: 'dahai';
  actor: Actor;
  pai: Tile;
  tsumogiri: boolean;
}

export interface ChiEvent {
  type: 'chi';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface PonEvent {
  type: 'pon';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface DaiminkanEvent {
  type: 'daiminkan';
  actor: Actor;
  target: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface AnkanEvent {
  type: 'ankan';
  actor: Actor;
  consumed: Tile[];
}

export interface KakanEvent {
  type: 'kakan';
  actor: Actor;
  pai: Tile;
  consumed: Tile[];
}

export interface ReachEvent {
  type: 'reach';
  actor: Actor;
}

export interface ReachAcceptedEvent {
  type: 'reach_accepted';
  actor: Actor;
}

export interface DoraEvent {
  type: 'dora';
  dora_marker: Tile;
}

export interface NukidoraEvent {
  type: 'kita';
  actor: Actor;
  pai: 'N';
}

export interface EndKyokuEvent {
  type: 'end_kyoku';
}

export interface HoraEvent {
  type: 'hora';
  actor: Actor;
  target: Actor;
  pai: Tile;
  scores: Score[];
  deltas: Score[];
}

export interface RyukyokuEvent {
  type: 'ryukyoku';
  scores: Score[];
  deltas: Score[];
  tenpais: boolean[];
  /** Why the hand was aborted, in `riichienv`'s spelling. */
  reason?: string;
}

export interface EndGameEvent {
  type: 'end_game';
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
