/**
 * 麻将动作配置
 */

export interface ActionConfigItem {
  label: string;
  color: string;
  gradient: string; // 用于背景光晕和文字渐变
}

export const ACTION_CONFIG: Record<string, ActionConfigItem> = {
  reach: {
    label: 'actions.reach',
    color: 'var(--color-action-reach)',
    gradient: 'from-orange-500 to-red-500',
  },
  chi: {
    label: 'actions.chi',
    color: 'var(--color-action-chi)',
    gradient: 'from-emerald-400 to-green-600',
  },
  pon: {
    label: 'actions.pon',
    color: 'var(--color-action-pon)',
    gradient: 'from-blue-400 to-indigo-600',
  },
  kan: {
    label: 'actions.kan',
    color: 'var(--color-action-kan)',
    gradient: 'from-purple-400 to-fuchsia-600',
  },
  ron: {
    label: 'actions.ron',
    color: 'var(--color-action-ron)',
    gradient: 'from-red-500 to-rose-700',
  },
  tsumo: {
    label: 'actions.tsumo',
    color: 'var(--color-action-tsumo)',
    gradient: 'from-red-600 to-rose-900',
  },
  ryukyoku: {
    label: 'actions.ryukyoku',
    color: 'var(--color-action-draw)',
    gradient: 'from-slate-400 to-slate-600',
  },
  nukidora: {
    label: 'actions.nukidora',
    color: 'var(--color-action-kita)',
    gradient: 'from-pink-400 to-rose-500',
  },
  none: {
    label: 'actions.none',
    color: 'var(--color-action-skip)',
    gradient: 'from-gray-400 to-gray-600',
  },
  discard: {
    label: 'actions.discard',
    color: 'var(--color-action-discard)',
    gradient: 'from-zinc-500 to-zinc-700',
  },
};

// 需要显示 consumed 牌的动作集合
export const SHOW_CONSUMED_ACTIONS = new Set(['chi', 'pon', 'kan']);
