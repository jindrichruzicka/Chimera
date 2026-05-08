import type { CSSProperties } from 'react';

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
    readonly id: string;
    readonly name: string;
    readonly palette: ThemePalette;
}
