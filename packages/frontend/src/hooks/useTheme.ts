import { use } from 'react';

import { ThemeContext } from '@/contexts/ThemeContext';

export function useTheme() {
  const context = use(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
}
