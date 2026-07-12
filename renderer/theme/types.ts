import type { CSSProperties } from 'react';

/**
 * Opaque theme identifier. Branded to prevent accidental mixing with other
 * string-shaped values (e.g. gameId, playerId).
 *
 * Use {@link themeId} to construct a value from a raw string.
 *
 * Reference: TypeScript §1.3 (branded / phantom types).
 */
export type ThemeId = string & { readonly __brand: 'ThemeId' };

/**
 * Constructs a branded {@link ThemeId} from a raw string.
 *
 * This is the single authorised cast site for the ThemeId brand.
 * All production code and test helpers must call this instead of
 * writing `raw as ThemeId` directly.
 */
export function themeId(raw: string): ThemeId {
    return raw as ThemeId;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonPalette {
    readonly base: CSSProperties;
    readonly variants: Readonly<Record<ButtonVariant, CSSProperties>>;
    readonly sizes: Readonly<Record<ButtonSize, CSSProperties>>;
}

export interface ThemePalette {
    readonly button: ButtonPalette;
}

export interface ThemeDefinition {
    readonly id: ThemeId;
    readonly name: string;
    readonly palette: ThemePalette;
}
