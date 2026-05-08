import { createContext } from 'react';
import type { ThemeDefinition } from './types';

export interface ThemeContextValue {
    readonly current: ThemeDefinition;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
