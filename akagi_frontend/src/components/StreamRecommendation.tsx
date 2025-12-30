import React, {useMemo} from 'react';
import {type ClassValue, clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';

// --- Types & Constants ---

interface RecommendationProps {
    action: string;
    confidence: number;
    consumed?: string[];
    last_kawa_tile: string;
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
    ryukyoku: {label: '流局', color: '#8574a1', gradient: 'from-slate-400 to-slate-600'},
    nukidora: {label: '拔北', color: '#d5508d', gradient: 'from-pink-400 to-rose-500'},
    none: {label: '跳过', color: '#a0a0a0', gradient: 'from-gray-400 to-gray-600'},
    // 默认打牌样式
    discard: {label: '打', color: '#3f3f46', gradient: 'from-zinc-500 to-zinc-700'}
};

const SHOW_CONSUMED_ACTIONS = new Set(['chi_low', 'chi_mid', 'chi_high', 'pon', 'kan_select']);

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// --- Sub-Components ---

// 1. 更加拟物化的麻将牌组件
const Tile: React.FC<{ tile: string; className?: string; isGhost?: boolean }> = ({tile, className, isGhost}) => {
    const svgPath = `/Resources/${tile}.svg`;

    return (
        <div className={cn(
            "relative flex flex-col items-center justify-start w-20 h-28 transition-transform duration-200",
            isGhost ? "opacity-50 grayscale" : "hover:-translate-y-1",
            className
        )}>
            {/* 牌面图片 */}
            <div
                className="relative w-full h-full z-10 rounded-[4px] overflow-hidden bg-white shadow-sm border border-zinc-200 dark:border-zinc-700">
                <img
                    src={svgPath}
                    alt={tile}
                    className="w-full h-full object-contain select-none p-[1px]"
                />
            </div>
            {/* 模拟厚度的底部 (伪3D) */}
            <div
                className="absolute -bottom-1 w-full h-full bg-zinc-300 dark:bg-zinc-800 rounded-[4px] -z-0 translate-y-1 border border-zinc-400 dark:border-zinc-900"/>
        </div>
    );
};

// 2. 环形进度条组件
const ConfidenceRing: React.FC<{ percentage: number; color: string }> = ({percentage, color}) => {
    // w-28 = 112px.
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage * circumference);

    return (
        <div className="relative flex items-center justify-center w-28 h-28">
            {/* 背景环 */}
            <svg className="transform -rotate-90 w-full h-full">
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke="currentColor" strokeWidth="8" fill="transparent"
                    className="text-zinc-200 dark:text-zinc-800"
                />
                {/* 进度环 */}
                <circle
                    cx="50%" cy="50%" r={radius}
                    stroke={color} strokeWidth="8" fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                />
            </svg>
            <div className="absolute flex flex-col items-center justify-center inset-0">
                    <span className="text-4xl font-bold text-zinc-700 dark:text-zinc-200 font-mono">
                        {(percentage * 100).toFixed(0)}
                        <span className="text-xl">%</span>
                    </span>
            </div>
        </div>
    );
};

// 3. 鸣牌显示逻辑优化
const ConsumedDisplay: React.FC<{
    action: string;
    consumed: string[];
    last_kawa_tile: string;
}> = ({action, consumed, last_kawa_tile}) => {
    if (!consumed || consumed.length === 0) return null;

    const isNaki = action.startsWith('chi') || action === 'pon' || action === 'kan_select';

    // 排序逻辑
    const handTiles = useMemo(() => {
        if (!isNaki) return consumed;
        const getTileValue = (t: string) => {
            const val = parseInt(t[0]);
            return isNaN(val) ? 99 : val;
        };
        return [...consumed].sort((a, b) => getTileValue(a) - getTileValue(b));
    }, [action, consumed, isNaki]);

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
            {/* 拿进来的牌 (Last Kawa) */}
            <div className="relative">
                <span
                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-zinc-400 whitespace-nowrap">Target</span>
                <Tile tile={last_kawa_tile} className="scale-90 opacity-90"/>
            </div>

            {/* 连接符 */}
            <div className="text-zinc-400 dark:text-zinc-500">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </div>

            {/* 手里的牌 */}
            <div className="flex gap-1">
                {handTiles.map((t, i) => <Tile key={i} tile={t}/>)}
            </div>
        </div>
    );
};

// --- Main Component ---

const Recommendation: React.FC<RecommendationProps> = ({
                                                           action,
                                                           confidence,
                                                           consumed,
                                                           last_kawa_tile,
                                                       }) => {
    const config = ACTION_CONFIG[action];
    // 默认为打牌逻辑
    const effectiveConfig = config || ACTION_CONFIG['discard'];
    const displayLabel = config ? config.label : '打';
    const mainTile = config ? null : action; // 如果不在配置表中，action字符串即为牌代码
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
                className="relative flex items-center justify-between p-6 pr-10 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-xl rounded-3xl border border-zinc-200/50 dark:border-zinc-700/50 shadow-xl overflow-hidden h-[180px]">

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
                <div className="flex-grow flex items-center justify-start gap-8">
                    {/* 情况A: 普通打牌 */}
                    {mainTile && (
                        <div className="flex items-center gap-5">
                            <Tile tile={mainTile} className="scale-110"/>
                            <div className="flex flex-col justify-center">
                                <span className="text-2xl font-bold text-zinc-600 dark:text-zinc-300">切出</span>
                                <span className="text-base text-zinc-400">Discard</span>
                            </div>
                        </div>
                    )}

                    {/* 情况B: 鸣牌组合 */}
                    {shouldShowConsumed && consumed && (
                        <ConsumedDisplay
                            action={action}
                            consumed={consumed}
                            last_kawa_tile={last_kawa_tile}
                        />
                    )}
                </div>

                {/* 右侧：置信度 */}
                <div className="flex flex-col items-center justify-center ml-6">
                    <ConfidenceRing percentage={confidence} color={effectiveConfig.color}/>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-[-2px] uppercase tracking-wider">
                            Confidence
                        </span>
                </div>
            </div>
        </div>
    );
};

export default Recommendation;