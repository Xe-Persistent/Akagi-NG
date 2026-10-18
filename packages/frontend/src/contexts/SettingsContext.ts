import { createContext } from 'react';

import type { Paths, PathValue, Settings } from '@/types';

/** Writes one field of the settings graph, with the path and value type-checked together. */
export type UpdateSetting = <P extends Paths<Settings>>(
  path: readonly [...P],
  value: PathValue<Settings, P>,
) => void;

export interface SettingsContextType {
  settings: Settings;
  isRestored: boolean;
  updateSetting: UpdateSetting;
  restoreDefaults: () => void;
  refreshSettings: () => Promise<void>;
  availableModels: string[];
}

export const SettingsContext = createContext<SettingsContextType | null>(null);
