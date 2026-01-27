import type { FC } from 'react';
import { useMemo } from 'react';

import { sortTiles } from '@/lib/mahjong';

import { MahjongTile } from './mahjong-tile';

interface ConsumedDisplayProps {
  action: string;
  consumed: string[];
  tile?: string;
}

export const ConsumedDisplay: FC<ConsumedDisplayProps> = ({ action, consumed, tile }) => {
  const isNaki = action === 'chi' || action === 'pon' || action === 'kan_select';

  // 暗杠检测：kan_select 且 4 张牌
  const isAnkan = action === 'kan_select' && consumed.length === 4;

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
    <div className='flex items-center gap-6 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-700/50 dark:bg-zinc-800/50'>
      {/* The tile called (Last Kawa or Ankan identifier) */}
      <div className='relative'>
        <MahjongTile tile={tile ?? '?'} />
      </div>

      {/* Connector Icon */}
      <div className='text-zinc-400 dark:text-zinc-500'>
        <svg
          width='32'
          height='32'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M5 12h14M12 5l7 7-7 7' />
        </svg>
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
};
