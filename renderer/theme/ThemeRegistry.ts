import type { ThemeDefinition, ThemeId } from './types';
import { getThemeFromRegistry, registerThemeInRegistry } from './ThemeRegistry.store';

export interface ThemeRegistryApi {
    register(id: ThemeId, theme: ThemeDefinition): void;
    get(id: ThemeId): ThemeDefinition | undefined;
}

export const ThemeRegistry: ThemeRegistryApi = {
    register(id: ThemeId, theme: ThemeDefinition): void {
        registerThemeInRegistry(id, theme);
    },
    get(id: ThemeId): ThemeDefinition | undefined {
        return getThemeFromRegistry(id);
    },
};
