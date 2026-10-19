/**
 * The majsoul wire vocabulary the parser layer has to spell out: the method
 * names a `Wrapper` frame carries, and the `type` values a couple of actions use
 * instead of named fields.
 *
 * They live apart from the bridge because `sync-replay` has to synthesise an
 * `ActionPrototype` notify from a recorded payload, and the bridge already
 * depends on that module -- a constant in the bridge could not be imported back
 * without a cycle.
 */

export const MAJSOUL_METHODS = {
  /** The game websocket's keep-alive: no game state, several per minute. */
  heartbeat: '.lq.Route.heartbeat',

  // FastTest carries everything that happens at a table.
  syncGame: '.lq.FastTest.syncGame',
  enterGame: '.lq.FastTest.enterGame',
  authGame: '.lq.FastTest.authGame',
  actionPrototype: '.lq.ActionPrototype',

  gameEndResult: '.lq.NotifyGameEndResult',
  gameTerminate: '.lq.NotifyGameTerminate',
} as const;

/** `ActionChiPengGang.type`: which call the action reports. */
export enum OperationChiPengGang {
  Chi = 0,
  Peng = 1,
  Gang = 2,
}

/** `ActionAnGangAddGang.type`: a kan taken from the hand, or added to a pon. */
export enum OperationAnGangAddGang {
  AddGang = 2,
  AnGang = 3,
}
