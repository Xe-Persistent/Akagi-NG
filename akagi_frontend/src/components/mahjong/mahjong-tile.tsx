import { type FC, memo } from 'react';

import { cn } from '@/lib/utils';

interface MahjongTileProps {
  tile: string;
  className?: string;
  isGhost?: boolean;
  isBack?: boolean;
}

export const MahjongTile: FC<MahjongTileProps> = memo(({ tile, className, isGhost, isBack }) => {
  const svgPath = `Resources/${tile}.svg`;

  return (
    <div
      className={cn(
        'mahjong-tile-container will-change-transform',
        isGhost ? 'opacity-50 grayscale' : 'hover:-translate-y-1',
        className,
      )}
    >
      {/* Tile Face or Back */}
      <div className='mahjong-tile-face'>
        {isBack ? (
          <div className='mahjong-tile-back'>
            {/* Texture Layers */}
            <div className='absolute inset-0 bg-linear-to-t from-black/10 to-transparent dark:from-black/30' />
            <div className='absolute inset-0 bg-linear-to-tr from-transparent via-white/20 to-transparent opacity-30 dark:opacity-20' />
          </div>
        ) : (
          <img src={svgPath} alt={tile} className='h-full w-full object-contain p-px select-none' />
        )}
      </div>
      {/* Pseudo-3D Thickness */}
      <div className='mahjong-tile-3d' />
    </div>
  );
});

MahjongTile.displayName = 'MahjongTile';
