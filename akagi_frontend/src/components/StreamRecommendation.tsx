import React, {useMemo} from 'react';
import {type ClassValue, clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';

// --- 类型 & 常量 ---

interface RecommendationProps {
    action: string;
    confidence: number;
    consumed?: string[];
    is_riichi_declaration?: boolean;
    sim_candidates?: { tile: string; confidence: number }[];
    tile?: string;
}

interface ActionConfigItem {
    label: string;
    color: string;
    gradient: string; // 新增：用于背景光晕和文字渐变
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

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// --- 子组件 ---

// 1. 更加拟物化的麻将牌组件
const Tile: React.FC<{ tile: string; className?: string; isGhost?: boolean; isBack?: boolean }> = ({
                                                                                                       tile,
                                                                                                       className,
                                                                                                       isGhost,
                                                                                                       isBack
                                                                                                   }) => {
    const svgPath = `/Resources/${tile}.svg`;

    return (
        <div className={cn(
            "relative flex flex-col items-center justify-start w-20 h-28 transition-transform duration-200",
            isGhost ? "opacity-50 grayscale" : "hover:-translate-y-1",
            className
        )}>
            {/* 牌面图片 OR 牌背 */}
            <div
                className="relative w-full h-full z-10 rounded-[4px] overflow-hidden bg-white shadow-sm border border-zinc-200 dark:border-zinc-700">
                {isBack ? (
                    <div
                        className="w-full h-full bg-gradient-to-br from-zinc-400 via-slate-500 to-slate-700 dark:from-indigo-900 dark:via-purple-950 dark:to-slate-900 border border-white/20 dark:border-white/10 shadow-inner">
                        {/* 纹理层 */}
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
            {/* 模拟厚度的底部 (伪3D) */}
            <div
                className="absolute -bottom-1 w-full h-full bg-zinc-300 dark:bg-zinc-500 rounded-[4px] -z-0 translate-y-1 border border-zinc-400 dark:border-zinc-600"/>
        </div>
    );
};

// 2. 环形进度条组件
const ConfidenceRing: React.FC<{
    percentage: number;
    color: string;
    size?: number;
    stroke?: number;
    fontSize?: string
}> = ({percentage, color, size = 112, stroke = 8, fontSize = "text-5xl"}) => {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage * circumference);

    return (
        <div style={{width: size, height: size}} className="relative flex items-center justify-center">
            {/* 背景环 */}
            <svg className="transform -rotate-90 w-full h-full">
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke="currentColor" strokeWidth={stroke} fill="transparent"
                    className="text-zinc-200 dark:text-zinc-800"
                />
                {/* 进度环 */}
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke={color} strokeWidth={stroke} fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center inset-0">
                <span className={`${fontSize} font-bold text-zinc-700 dark:text-zinc-200 font-mono`}>
                    {(percentage * 100).toFixed(0)}
                    <span className="text-[0.6em]">%</span>
                </span>
            </div>
        </div>
    );
};

// 3. 鸣牌展示组件
const ConsumedDisplay: React.FC<{
    action: string;
    consumed: string[];
    tile?: string;
}> = ({action, consumed, tile}) => {
    const isNaki = action.startsWith('chi') || action === 'pon' || action === 'kan_select';

    // Ankan detection: kan_select with 4 consumed tiles
    const isAnkan = action === 'kan_select' && consumed.length === 4;

    // 排序逻辑
    const handTiles = useMemo(() => {
        if (!consumed || consumed.length === 0) return [];
        if (!isNaki) return consumed;
        const getTileValue = (t: string) => {
            const val = parseInt(t[0]);
            return isNaN(val) ? 99 : val;
        };
        return [...consumed].sort((a, b) => getTileValue(a) - getTileValue(b));
    }, [consumed, isNaki]);

    if (!isNaki) {
        return (
            <div className="flex gap-1">
                {handTiles.map((t, i) => <Tile key={i} tile={t}/>)}
            </div>
        );
    }

    return (
        <div
            className="flex items-center gap-6 bg-zinc-50 dark:bg-zinc-800/50 px-5 py-4 rounded-xl border border-zinc-200 dark:border-zinc-700/50">
            {/* 拿进来的牌 (Last Kawa 或 暗杠标识牌) */}
            <div className="relative">
                <Tile tile={tile ?? "?"}/>
            </div>

            {/* 连接符 */}
            <div className="text-zinc-400 dark:text-zinc-500">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </div>

            {/* 手里的牌: 如果是暗杠，第一张和第四张显示牌背 */}
            <div className="flex gap-1">
                {handTiles.map((t, i) => {
                    const showBack = isAnkan && (i === 0 || i === 3);
                    return <Tile key={i} tile={t} isBack={showBack}/>;
                })}
            </div>
        </div>
    );
};

// --- 主组件 ---

const Recommendation: React.FC<RecommendationProps> = ({
                                                           action,
                                                           confidence,
                                                           consumed,
                                                           is_riichi_declaration,
                                                           sim_candidates,
                                                           tile,
                                                       }) => {
    const config = ACTION_CONFIG[action];
    const hasSimCandidates = sim_candidates && sim_candidates.length > 0;

    // 确定配置:
    // 1. 如果有严格匹配的动作 (reach, pon 等), 使用它.
    // 2. 如果没有匹配 (比如是切牌), 检查是否处于立直宣言状态 -> 使用 reach 样式.
    // 3. 否则默认为普通切牌样式 (discard).
    const effectiveConfig = config || (is_riichi_declaration ? ACTION_CONFIG['reach'] : ACTION_CONFIG['discard']);

    const displayLabel = effectiveConfig.label;

    // 确定要显示的主牌 (如果有)
    // 如果有 sim_candidates (立直Lookahead), 这里不显示单一主牌.
    // 如果 config 存在 (如 pon/chi/hora), 通常没有主牌 (在ConsumedDisplay里显示).
    // 特例: 'tsumo' 和 'hora' (Ron) 逻辑可能需要显示赢的那张牌.
    // 目前后端为 'tsumo' 提供了 'tile'.
    let mainTile: string | null = null;
    if (!hasSimCandidates) {
        if (action === 'tsumo' && tile) {
            mainTile = tile;
        } else if (!config) {
            mainTile = action; // 这是一个切牌动作 (动作字符串本身就是牌代码)
        }
    }

    const shouldShowConsumed = consumed && SHOW_CONSUMED_ACTIONS.has(action);

    return (
        <div className="relative group w-full mx-auto">
            {/* 1. 背景光晕 (Glow Effect) */}
            <div
                className={cn(
                    "absolute -inset-0.5 rounded-3xl blur opacity-30 dark:opacity-40 transition duration-500 group-hover:opacity-60 bg-gradient-to-r",
                    effectiveConfig.gradient
                )}
            />

            {/* 2. 主容器 (Glassmorphism) */}
            <div
                className="relative flex items-center justify-between p-4 pr-10 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-xl rounded-3xl border border-zinc-200/50 dark:border-zinc-700/50 shadow-xl overflow-hidden h-[180px]">

                {/* 装饰：左侧彩色条 */}
                <div
                    className={cn("absolute left-0 top-0 bottom-0 w-2", `bg-gradient-to-b ${effectiveConfig.gradient}`)}/>

                {/* 左侧：动作名称 */}
                <div className="flex flex-col items-center justify-center w-40 h-full mr-6 z-10">
                    <h2
                        className={cn(
                            "text-6xl font-black tracking-widest bg-clip-text text-transparent bg-gradient-to-br filter drop-shadow-sm",
                            effectiveConfig.gradient
                        )}
                        style={{textShadow: '0 2px 10px rgba(0,0,0,0.1)'}}
                    >
                        {displayLabel}
                    </h2>
                </div>

                {/* 分隔线 */}
                <div className="w-[1px] h-24 bg-zinc-200 dark:bg-zinc-700 mr-10"/>

                {/* 中间：牌面显示区域 */}
                <div
                    className="flex-grow flex items-center justify-start gap-8 overflow-x-auto overflow-y-hidden h-full px-2">

                    {/* 情况A: 立直宣言牌预测 */}
                    {hasSimCandidates ? (
                        <div className="flex gap-8">
                            {sim_candidates.map((cand, idx) => (
                                <div key={idx} className="flex flex-row items-end gap-4">
                                    {/* Tile */}
                                    <Tile tile={cand.tile} className="scale-110 shadow-md"/>
                                    {/* 展示每张候选牌的置信度 (仅当候选大于1时) */}
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
                            {/* 情况B: 自摸 (仅显示牌) */}
                            {action === 'tsumo' && mainTile && (
                                <div className="flex items-center gap-5">
                                    <Tile tile={mainTile} className="scale-110"/>
                                </div>
                            )}

                            {/* 情况C: 普通打牌 (显示牌 + 文字) */}
                            {action !== 'tsumo' && mainTile && (
                                <div className="flex items-center gap-5">
                                    <Tile tile={mainTile} className="scale-110"/>
                                    <div className="flex flex-col justify-center">
                                        <span
                                            className="text-2xl font-bold text-zinc-600 dark:text-zinc-300">切出</span>
                                        <span className="text-base text-zinc-400">Discard</span>
                                    </div>
                                </div>
                            )}

                            {/* 情况D: 鸣牌组合 */}
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

                {/* 右侧：置信度 */}
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