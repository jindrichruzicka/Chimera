import { defaultTheme } from './default-theme';
import type { ThemeDefinition, ThemeId } from './types';

/**
 * Internal registry map.
 *
 * Exported only for direct manipulation by `__test-support__/ThemeRegistry.test-helpers.ts`.
 * All production code must go through {@link registerThemeInRegistry} and
 * {@link getThemeFromRegistry} — never mutate this Map directly.
 *
 * @internal
 */
export const registry = new Map<ThemeId, ThemeDefinition>([[defaultTheme.id, defaultTheme]]);

export function registerThemeInRegistry(id: ThemeId, theme: ThemeDefinition): void {
    registry.set(id, theme);
}

export function getThemeFromRegistry(id: ThemeId): ThemeDefinition | undefined {
    return registry.get(id);
}
