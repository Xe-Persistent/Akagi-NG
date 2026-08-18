import { createContext } from 'react';

import type { Theme } from '@/types';

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: Exclude<Theme, 'system'>;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextType | null>(null);
