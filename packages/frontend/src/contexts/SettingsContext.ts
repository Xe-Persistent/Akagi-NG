import { createContext } from 'react';

import type { Paths, PathValue, Settings } from '@/types';

export interface SettingsContextType {
  settings: Settings;
  saveStatus: 'saved' | 'saving' | 'error';
  restartRequired: boolean;
  isRestored: boolean;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
  restoreDefaults: () => void;
  refreshSettings: () => Promise<void>;
  availableModels: string[];
}

export const SettingsContext = createContext<SettingsContextType | null>(null);
