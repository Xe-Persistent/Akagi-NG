import type {FC} from 'react';
import {cn} from '@/lib/utils';

import {MahjongTile} from '@/components/mahjong/mahjong-tile';
import {ConfidenceRing} from '@/components/mahjong/confidence-ring';
import {ConsumedDisplay} from '@/components/mahjong/consumed-display';

// --- Types & Constants ---

interface RecommendationProps {
    action: string;
    confidence: number;
    consumed?: string[];
    sim_candidates?: { tile: string; confidence: number }[];
    tile?: string;
}

interface ActionConfigItem {
    label: string;
    color: string;
    gradient: string; // Used for background glow and text gradient
}

const ACTION_CONFIG: Record<string, ActionConfigItem> = {
    reach: {label: '立直', color: '#e06c20', gradient: 'from-orange-500 to-red-500'},
    chi_low: {label: '吃', color: '#00ff80', gradient: 'from-emerald-400 to-green-600'},
    chi_mid: {label: '吃', color: '#00ff80', gradient: 'from-emerald-400 to-green-600'},
    chi_high: {label: '吃', color: '#00ff80', gradient: 'from-emerald-400 to-green-600'},
    pon: {label: '碰', color: '#007fff', gradient: 'from-blue-400 to-indigo-600'},
    kan_select: {label: '杠', color: '#9a1cbd', gradient: 'from-purple-400 to-fuchsia-600'},
    hora: {label: '和', color: '#c13535', gradient: 'from-red-500 to-rose-700'},
    tsumo: {label: '自摸', color: '#b91c1c', gradient: 'from-red-600 to-rose-900'},
    ryukyoku: {label: '流局', color: '#8574a1', gradient: 'from-slate-400 to-slate-600'},
    nukidora: {label: '拔北', color: '#d5508d', gradient: 'from-pink-400 to-rose-500'},
    none: {label: '跳过', color: '#a0a0a0', gradient: 'from-gray-400 to-gray-600'},
    discard: {label: '打', color: '#3f3f46', gradient: 'from-zinc-500 to-zinc-700'},
};

const SHOW_CONSUMED_ACTIONS = new Set(['chi_low', 'chi_mid', 'chi_high', 'pon', 'kan_select']);


// --- Main Component ---

const Recommendation: FC<RecommendationProps> = ({
                                                     action,
                                                     confidence,
                                                     consumed,
                                                     sim_candidates,
                                                     tile,
                                                 }) => {
    const config = ACTION_CONFIG[action];
    const hasSimCandidates = sim_candidates && sim_candidates.length > 0;

    // Determine configuration:
    // 1. If strict match (reach, pon etc), use it.
    // 2. Default to discard style.
    const effectiveConfig = config || ACTION_CONFIG['discard'];

    const displayLabel = effectiveConfig.label;

    // Determine main tile to display
    // If sim_candidates (Riichi Lookahead), main tile is not single.
    // If config exists (pon/chi/hora), usually handled by ConsumedDisplay.
    // Exceptions: 'tsumo' and 'hora' (Ron) might need to show the winning tile.
    let mainTile: string | null = null;
    if (!hasSimCandidates) {
        if (action === 'tsumo' && tile) {
            mainTile = tile;
        } else if (!config) {
            mainTile = action; // It's a discard action (action string is the tile code)
        }
    }

    const shouldShowConsumed = consumed && SHOW_CONSUMED_ACTIONS.has(action);

    return (
        <div className="relative group w-full mx-auto">
            {/* 1. Background Glow Effect */}
            <div
                className={cn(
                    "background-glow",
                    effectiveConfig.gradient
                )}
            />

            {/* 2. Main Container (Glassmorphism) */}
            <div className="glass-card">

                {/* Decoration: Left Strip */}
                <div
                    className={cn("absolute left-0 top-0 bottom-0 w-2", `bg-linear-to-b ${effectiveConfig.gradient}`)}/>

                {/* Left: Action Label */}
                <div className="flex flex-col items-center justify-center w-40 h-full mr-6 z-10">
                    <h2
                        className={cn(
                            "action-text-gradient",
                            effectiveConfig.gradient
                        )}
                        style={{textShadow: '0 2px 10px rgba(0,0,0,0.1)'}}
                    >
                        {displayLabel}
                    </h2>
                </div>

                {/* Separator */}
                <div className="w-px h-24 bg-zinc-200 dark:bg-zinc-700 mr-10"/>

                {/* Center: Tile Display Area */}
                <div
                    className="grow flex items-center justify-start gap-8 overflow-x-auto overflow-y-hidden h-full px-2">

                    {/* Case A: Riichi Declaration Candidates */}
                    {hasSimCandidates ? (
                        <div className="flex gap-8">
                            {sim_candidates.map((cand, idx) => (
                                <div key={idx} className="flex flex-row items-end gap-4">
                                    {/* Tile */}
                                    <MahjongTile tile={cand.tile} className="scale-110 shadow-md"/>
                                    {/* Show confidence for each candidate (only if > 1) */}
                                    {sim_candidates.length > 1 && (
                                        <div className="mb-1">
                                            <ConfidenceRing
                                                percentage={cand.confidence}
                                                color={effectiveConfig.color}
                                                size={64}
                                                stroke={6}
                                                fontSize="text-2xl"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            {/* Case B: Single Tile Display (Tsumo / Discard) */}
                            {mainTile && (
                                <div className="flex items-center gap-5">
                                    <MahjongTile tile={mainTile} className="scale-110"/>
                                </div>
                            )}

                            {/* Case C: Called Combinations (Chi, Pon, Kan) */}
                            {shouldShowConsumed && consumed && (
                                <ConsumedDisplay
                                    action={action}
                                    consumed={consumed}
                                    tile={tile}
                                />
                            )}
                        </>
                    )}
                </div>

                {/* Right: Confidence */}
                <div className="flex flex-col items-center justify-center ml-6">
                    <ConfidenceRing percentage={confidence} color={effectiveConfig.color}/>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-2 uppercase tracking-wider">
                        Confidence
                    </span>
                </div>
            </div>
        </div>
    );
};

export default Recommendation;