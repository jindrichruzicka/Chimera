'use client';

import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { defaultTheme } from './default-theme';
import { ThemeContext } from './theme-context';
import type { ThemeDefinition } from './types';

export interface ThemeProviderProps {
    readonly theme?: ThemeDefinition;
    readonly children: ReactNode;
}

export function ThemeProvider({
    theme = defaultTheme,
    children,
}: ThemeProviderProps): React.ReactElement {
    const contextValue = useMemo(() => ({ current: theme }), [theme]);

    return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}
