/**
 * The xuezhan (blood battle) protocol: everything the mode does differently from a
 * plain four-player game, as plain functions over decoded payloads.
 *
 * Confirmed against real captures (`logs/akagi_20261016_*`):
 * - every round deals with an empty dora list, offers a three-tile swap
 *   (`operationList[].type === 12`) and reports the swap in `ActionChangeTile`,
 *   which is also where the round's dora indicator arrives;
 * - a win is reported by `ActionHuleXueZhanMid` and settles immediately, but the
 *   round carries on without the players who have already won; the third win
 *   arrives as `ActionHuleXueZhanEnd` and ends the round;
 * - the match ends on a knockout (`NotifyGameEndResult`), not on a payload flag.
 */

/** `operationList[].type` of the swap offer that opens every xuezhan round. */
export const XUEZHAN_SWAP_OPERATION = 12;

/** A win as the mode reports it, before it becomes a mjai event. */
export interface XuezhanWin {
  seat: number;
  pai: string;
  zimo: boolean;
}

type Payload = Record<string, unknown>;

/** The room rules arrive with `authGame`; `xuezhandaodi` is the blood battle. */
export function isXuezhanRule(gameConfig: unknown): boolean {
  const rule = (gameConfig as { mode?: { detailRule?: { xuezhandaodi?: number } } } | undefined)
    ?.mode?.detailRule;
  return rule?.xuezhandaodi === 1;
}

/** Whether a deal carries the swap offer, i.e. whether it belongs to this mode. */
export function offersSwap(data: Payload): boolean {
  return operations(data).some((operation) => operation.type === XUEZHAN_SWAP_OPERATION);
}

/**
 * Applies the swap to a dealt hand: the tiles that left are removed, the ones that
 * arrived are added. The payload only names what moved, and a hand can hold the
 * same tile twice, so tiles are removed one occurrence at a time.
 */
export function applySwap(
  tiles: string[],
  out: string[],
  incoming: string[],
): { hand: string[]; missing: string[] } {
  const hand = [...tiles];
  const missing: string[] = [];

  for (const tile of out) {
    const index = hand.indexOf(tile);
    if (index >= 0) hand.splice(index, 1);
    else missing.push(tile);
  }

  return { hand: [...hand, ...incoming], missing };
}

/**
 * Reads a mid-game or final blood-battle win. The payload repeats the round's
 * earlier wins in `hulesHistory`, which the Mid events already reported, so only
 * `hules` is converted.
 */
export function parseXuezhanWins(data: Payload, endsRound: boolean): XuezhanWin[] {
  const hules = (data.hules as Payload[] | undefined) ?? [];

  return hules.map((hule) => ({
    seat: hule.seat as number,
    pai: hule.huTile as string,
    zimo: hule.zimo === true,
    endsRound,
  }));
}

function operations(data: Payload): Payload[] {
  const operation = data.operation as Payload | undefined;
  return (operation?.operationList as Payload[] | undefined) ?? [];
}
