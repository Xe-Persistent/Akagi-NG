import { createContext } from 'react';

import type { Paths, PathValue, Settings } from '@/types';

export interface SettingsContextType {
  settings: Settings | null;
  saveStatus: 'saved' | 'saving' | 'error';
  restartRequired: boolean;
  updateSetting: <P extends Paths<Settings>>(
    path: readonly [...P],
    value: PathValue<Settings, P>,
    shouldDebounce?: boolean,
  ) => void;
  updateSettingsBatch: (
    updates: { path: readonly string[]; value: unknown }[],
    shouldDebounce?: boolean,
  ) => void;
  restoreDefaults: () => void;
  refreshSettings: () => Promise<void>;
  availableModels: string[];
}

export const SettingsContext = createContext<SettingsContextType | null>(null);
