'use client';

import { useMemo } from 'react';
import { defaultTheme } from './default-theme';
import { ThemeRegistry } from './ThemeRegistry';
import type { ThemeDefinition, ThemeId } from './types';

/**
 * Returns the registered ThemeDefinition for the given id, falling back to the
 * engine-default theme when the id is not registered.
 *
 * Usage (in a game scene component):
 *
 *   const theme = useThemeOverride(themeId('my-game-theme'));
 *   return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
 *
 * The nested ThemeProvider ensures child components read the override theme.
 * When the component unmounts, the parent ThemeProvider's default theme is
 * automatically restored — no explicit cleanup needed.
 */
export function useThemeOverride(id: ThemeId): ThemeDefinition {
    return useMemo(() => ThemeRegistry.get(id) ?? defaultTheme, [id]);
}
