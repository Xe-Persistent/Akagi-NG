import { use } from 'react';

import { SettingsContext } from '@/contexts/SettingsContext';

export function useSettings() {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
