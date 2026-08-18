import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';

import { sortTiles } from '@/lib/mahjong';

import { MahjongTile } from './mahjong-tile';

interface ConsumedDisplayProps {
  action: string;
  consumed: string[];
  tile?: string;
}

export function ConsumedDisplay({ action, consumed, tile }: ConsumedDisplayProps) {
  const isNaki = action === 'chi' || action === 'pon' || action === 'kan';
  const isAnkan = action === 'kan' && consumed.length === 4;
  const isKakan = action === 'kan' && consumed.length === 1;

  // 排序及视觉规约对齐逻辑
  const handTiles = useMemo(() => {
    if (!consumed.length) return [];
    if (!isNaki) return consumed;

    const sorted = sortTiles(consumed);
    const aka = sorted.find((t) => t.endsWith('r'));

    // 针对不同鸣牌类型的赤宝牌固定位置规约
    if (aka) {
      const rest = sorted.filter((t) => t !== aka);
      // 暗杠：插入至左数第二张
      if (isAnkan) return [rest[0], aka, rest[1], rest[2]];
      // 碰、大明杠、加杠：置于首位
      if (action === 'pon' || action === 'kan') return [aka, ...rest];
    }

    return sorted;
  }, [action, consumed, isAnkan, isNaki]);

  const tileItems = useMemo(() => {
    return handTiles.map((t) => ({ tile: t, id: crypto.randomUUID() }));
  }, [handTiles]);

  const ghostItems = useMemo(() => {
    return Array.from({ length: 3 }).map(() => crypto.randomUUID());
  }, []);

  if (!isNaki) {
    return (
      <div className='flex gap-1'>
        {tileItems.map((item) => (
          <MahjongTile key={item.id} tile={item.tile} />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* 要鸣的牌（一般是牌河的最后一张） */}
      <MahjongTile tile={tile!} />

      {/* 箭头 */}
      <div className='text-zinc-400 dark:text-zinc-500'>
        <ArrowRight size={32} />
      </div>

      <div className='flex gap-1'>
        {/* 构成副露的牌 */}
        {tileItems.map((item, i) => (
          <MahjongTile
            key={`hand-${item.id}`}
            tile={item.tile}
            isBack={isAnkan && (i === 0 || i === 3)}
          />
        ))}
        {/* 加杠时展示之前碰的牌 */}
        {isKakan &&
          ghostItems.map((gid) => <MahjongTile key={gid} tile={tile!.replace('r', '')} isGhost />)}
      </div>
    </>
  );
}
