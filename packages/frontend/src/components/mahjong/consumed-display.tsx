import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import { type MeldSlot, meldSlots } from '@/lib/mahjong';

import { MahjongTile } from './mahjong-tile';

interface ConsumedDisplayProps {
  /** Only the calls that show their tiles reach this component (`chi`/`pon`/`kan`). */
  action: string;
  consumed: string[];
  tile?: string;
}

/** The three copies a kakan already had on the table. */
const KAKAN_GHOST_SLOTS = ['ghost-1', 'ghost-2', 'ghost-3'] as const;

/** A meld can hold the same tile twice, so the key pairs it with its occurrence. */
function withOccurrenceKeys(slots: MeldSlot[]): (MeldSlot & { key: string })[] {
  const seen = new Map<string, number>();

  return slots.map((slot) => {
    const occurrence = seen.get(slot.tile) ?? 0;
    seen.set(slot.tile, occurrence + 1);
    return { ...slot, key: `${slot.tile}#${occurrence}` };
  });
}

export function ConsumedDisplay({ action, consumed, tile }: ConsumedDisplayProps) {
  const isClosedKan = action === 'kan' && consumed.length === 4;
  const isKakan = action === 'kan' && consumed.length === 1;

  const slotItems = useMemo(
    () => withOccurrenceKeys(meldSlots(action, consumed)),
    [action, consumed],
  );

  // A closed kan claims nothing from the table: four tiles of our own, with the
  // outer two turned over, so it is drawn on its own -- no claimed tile, no arrow.
  if (isClosedKan) {
    return (
      <div className='flex gap-1'>
        {slotItems.map((item) => (
          <MahjongTile key={item.key} tile={item.tile} isBack={item.isBack} />
        ))}
      </div>
    );
  }

  // An open call always names the tile it claims; there is nothing sensible to draw without it.
  if (!tile) return null;

  return (
    <>
      {/* The tile being claimed. */}
      <MahjongTile tile={tile} />

      <div className='text-zinc-400 dark:text-zinc-500'>
        <ArrowRight size={32} />
      </div>

      <div className='flex gap-1'>
        {slotItems.map((item) => (
          <MahjongTile key={item.key} tile={item.tile} />
        ))}
        {/* A kakan shows the copies the pon already had on the table. */}
        {isKakan &&
          KAKAN_GHOST_SLOTS.map((key) => (
            <MahjongTile key={key} tile={tile.replace('r', '')} isGhost />
          ))}
      </div>
    </>
  );
}
