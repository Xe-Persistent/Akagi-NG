import React from 'react';
import {cn} from "@/lib/utils";

interface MahjongTileProps {
    tile: string;
    className?: string;
    isGhost?: boolean;
    isBack?: boolean;
}

export const MahjongTile: React.FC<MahjongTileProps> = ({
                                                            tile,
                                                            className,
                                                            isGhost,
                                                            isBack
                                                        }) => {
    // Note: Ideally this path should be configurable or passed in context if it changes often,
    // but relative to public/Resources is fine for now.
    const svgPath = `/Resources/${tile}.svg`;

    return (
        <div className={cn(
            "relative flex flex-col items-center justify-start w-20 h-28 transition-transform duration-200",
            isGhost ? "opacity-50 grayscale" : "hover:-translate-y-1",
            className
        )}>
            {/* Tile Face or Back */}
            <div
                className="relative w-full h-full z-10 rounded-[4px] overflow-hidden bg-white shadow-sm border border-zinc-200 dark:border-zinc-700">
                {isBack ? (
                    <div
                        className="w-full h-full bg-gradient-to-br from-zinc-400 via-slate-500 to-slate-700 dark:from-indigo-900 dark:via-purple-950 dark:to-slate-900 border border-white/20 dark:border-white/10 shadow-inner">
                        {/* Texture Layers */}
                        <div
                            className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent dark:from-black/30"/>
                        <div
                            className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent opacity-30 dark:opacity-20"/>
                    </div>
                ) : (
                    <img
                        src={svgPath}
                        alt={tile}
                        className="w-full h-full object-contain select-none p-[1px]"
                    />
                )}
            </div>
            {/* Pseudo-3D Thickness */}
            <div
                className="absolute -bottom-1 w-full h-full bg-zinc-300 dark:bg-zinc-500 rounded-[4px] -z-0 translate-y-1 border border-zinc-400 dark:border-zinc-600"/>
        </div>
    );
};
