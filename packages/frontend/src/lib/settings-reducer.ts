import type { Settings } from '@/types';

export interface SettingsState {
  settings: Settings;
  /** Bumped by every local edit; the save effect watches it. */
  revision: number;
  isRestored: boolean;
  availableModels: string[];
}

export type SettingsAction =
  | { type: 'SYNC'; payload: Settings; revision?: number }
  | { type: 'REMOTE_UPDATE'; payload: { locale: string } }
  | { type: 'USER_UPDATE'; path: readonly string[]; value: unknown }
  | { type: 'RESTORE_SUCCESS'; payload: Settings }
  | { type: 'SET_AVAILABLE_MODELS'; payload: string[] };

export function createSettingsState(settings: Settings): SettingsState {
  return { settings, revision: 0, isRestored: false, availableModels: [] };
}

function setByPath(root: Record<string, unknown>, path: readonly string[], value: unknown) {
  let current: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SYNC':
      // A response for an older edit must not undo a newer one.
      if (action.revision !== undefined && action.revision !== state.revision) return state;
      if (JSON.stringify(state.settings) === JSON.stringify(action.payload)) return state;
      return { ...state, settings: action.payload };

    case 'REMOTE_UPDATE':
      if (state.settings.locale === action.payload.locale) return state;
      return { ...state, settings: { ...state.settings, locale: action.payload.locale } };

    case 'USER_UPDATE': {
      const nextSettings = structuredClone(state.settings) as unknown as Record<string, unknown>;
      setByPath(nextSettings, action.path, action.value);
      return {
        ...state,
        settings: nextSettings as unknown as Settings,
        revision: state.revision + 1,
        isRestored: false,
      };
    }

    case 'RESTORE_SUCCESS':
      return { ...state, settings: action.payload, isRestored: true };

    case 'SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.payload };
  }
}
