import { describe, expect, it } from 'vitest';
import { defaultTheme } from './default-theme';
import type { ButtonVariant, ThemeDefinition, ThemePalette } from './types';

describe('defaultTheme', () => {
    it('exports a ThemeDefinition with neutral engine defaults', () => {
        const theme: ThemeDefinition = defaultTheme;
        const palette: ThemePalette = theme.palette;
        const variant: ButtonVariant = 'primary';

        expect(theme.id).toBe('engine-default');
        expect(theme.name).toBe('Engine Default');
        expect(palette.button.base).toMatchObject({
            borderRadius: 'var(--ch-button-radius)',
            boxShadow: 'var(--ch-button-shadow)',
            fontSize: 'var(--ch-button-font-size-md)',
            fontWeight: 'var(--ch-button-font-weight)',
            lineHeight: 'var(--ch-button-line-height-md)',
            transform: 'var(--ch-button-transform)',
        });
        expect(palette.button.variants[variant]).toEqual({
            backgroundColor: 'var(--ch-color-accent)',
            borderColor: 'var(--ch-color-accent-hover)',
            color: 'var(--ch-color-text-primary)',
        });
        expect(palette.button.sizes).toMatchObject({
            sm: {
                fontSize: 'var(--ch-button-font-size-sm)',
                lineHeight: 'var(--ch-button-line-height-sm)',
                minWidth: 'calc(var(--ch-space-xl) * 4)',
                padding: 'var(--ch-button-padding-sm)',
            },
            md: {
                fontSize: 'var(--ch-button-font-size-md)',
                lineHeight: 'var(--ch-button-line-height-md)',
                minWidth: 'calc(var(--ch-space-xl) * 5)',
                padding: 'var(--ch-button-padding-md)',
            },
            lg: {
                fontSize: 'var(--ch-button-font-size-lg)',
                lineHeight: 'var(--ch-button-line-height-lg)',
                minWidth: 'calc(var(--ch-space-xl) * 6)',
                padding: 'var(--ch-button-padding-lg)',
            },
        });
    });

    it('defines every semantic button variant required by shell pages', () => {
        expect(Object.keys(defaultTheme.palette.button.variants)).toEqual([
            'primary',
            'secondary',
            'ghost',
            'danger',
        ]);
    });
});
