import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import { sortTiles } from '@/lib/mahjong';

import { MahjongTile } from './mahjong-tile';

interface ConsumedDisplayProps {
  action: string;
  consumed: string[];
  tile?: string;
}

/** The three copies a kakan already had on the table. */
const KAKAN_GHOST_SLOTS = ['ghost-1', 'ghost-2', 'ghost-3'] as const;

/** A meld can hold the same tile twice, so the key pairs it with its occurrence. */
function withOccurrenceKeys(tiles: string[]): { tile: string; key: string }[] {
  const seen = new Map<string, number>();

  return tiles.map((tile) => {
    const occurrence = seen.get(tile) ?? 0;
    seen.set(tile, occurrence + 1);
    return { tile, key: `${tile}#${occurrence}` };
  });
}

export function ConsumedDisplay({ action, consumed, tile }: ConsumedDisplayProps) {
  const isNaki = action === 'chi' || action === 'pon' || action === 'kan';
  const isAnkan = action === 'kan' && consumed.length === 4;
  const isKakan = action === 'kan' && consumed.length === 1;

  const handTiles = useMemo(() => {
    if (!consumed.length) return [];
    if (!isNaki) return consumed;

    const sorted = sortTiles(consumed);
    const aka = sorted.find((t) => t.endsWith('r'));

    // Where the red five sits depends on the call type.
    if (aka) {
      const rest = sorted.filter((t) => t !== aka);
      // A closed kan keeps it second from the left.
      if (isAnkan) return [rest[0], aka, rest[1], rest[2]];
      // Pon and open kans put it first.
      if (action === 'pon' || action === 'kan') return [aka, ...rest];
    }

    return sorted;
  }, [action, consumed, isAnkan, isNaki]);

  const tileItems = useMemo(() => withOccurrenceKeys(handTiles), [handTiles]);

  if (!isNaki) {
    return (
      <div className='flex gap-1'>
        {tileItems.map((item) => (
          <MahjongTile key={item.key} tile={item.tile} />
        ))}
      </div>
    );
  }

  // A call always names the tile it claims; there is nothing sensible to draw without it.
  if (!tile) return null;

  return (
    <>
      {/* The tile being claimed. */}
      <MahjongTile tile={tile} />

      <div className='text-zinc-400 dark:text-zinc-500'>
        <ArrowRight size={32} />
      </div>

      <div className='flex gap-1'>
        {tileItems.map((item, index) => (
          <MahjongTile
            key={item.key}
            tile={item.tile}
            isBack={isAnkan && (index === 0 || index === 3)}
          />
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
