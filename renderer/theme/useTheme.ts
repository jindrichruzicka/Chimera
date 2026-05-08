'use client';

import { useContext } from 'react';
import { ThemeContext } from './theme-context';
import type { ThemeContextValue } from './theme-context';

export function useTheme(): ThemeContextValue {
    const context = useContext(ThemeContext);

    if (context === null) {
        throw new Error('useTheme must be used within ThemeProvider');
    }

    return context;
}
