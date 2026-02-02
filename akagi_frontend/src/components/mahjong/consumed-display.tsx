import { ArrowRight } from 'lucide-react';
import { type FC, memo, useMemo } from 'react';

import { sortTiles } from '@/lib/mahjong';

import { MahjongTile } from './mahjong-tile';

interface ConsumedDisplayProps {
  action: string;
  consumed: string[];
  tile?: string;
}

export const ConsumedDisplay: FC<ConsumedDisplayProps> = memo(({ action, consumed, tile }) => {
  const isNaki = action === 'chi' || action === 'pon' || action === 'kan';

  // 暗杠检测：action === 'kan 且 4 张牌
  const isAnkan = action === 'kan' && consumed.length === 4;

  // 排序逻辑
  const handTiles = useMemo(() => {
    if (!consumed || consumed.length === 0) return [];
    if (!isNaki) return consumed;

    return sortTiles(consumed);
  }, [consumed, isNaki]);

  if (!isNaki) {
    return (
      <div className='flex gap-1'>
        {handTiles.map((t, i) => (
          <MahjongTile key={i} tile={t} />
        ))}
      </div>
    );
  }

  return (
    <div className='flex items-center gap-6 rounded-xl border border-white/30 bg-white/20 px-5 py-4 shadow-sm dark:border-white/10 dark:bg-black/20'>
      {/* The tile called (Last Kawa or kan identifier) */}
      <div className='relative'>
        <MahjongTile tile={tile ?? '?'} />
      </div>

      {/* Connector Icon */}
      <div className='text-zinc-400 dark:text-zinc-500'>
        <ArrowRight size={32} />
      </div>

      {/* Tiles in hand: if Ankan, show back for 1st and 4th */}
      <div className='flex gap-1'>
        {handTiles.map((t, i) => {
          const showBack = isAnkan && (i === 0 || i === 3);
          return <MahjongTile key={i} tile={t} isBack={showBack} />;
        })}
      </div>
    </div>
  );
});

ConsumedDisplay.displayName = 'ConsumedDisplay';
