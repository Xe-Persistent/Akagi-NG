export class AkagiEngine {
  constructor(modelBytes: Buffer, numPlayers: number, seat: number)
  reset(): void
  setSeat(seat: number): void
  feedLine(line: string): boolean
  decide(): string | null
}
