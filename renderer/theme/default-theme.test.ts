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
            fontSize: 'var(--ch-font-size-lg)',
            fontWeight: 600,
            lineHeight: 1.1,
            transform: 'var(--ch-button-transform)',
        });
        expect(palette.button.variants[variant]).toEqual({
            backgroundColor: 'var(--ch-color-accent)',
            borderColor: 'var(--ch-color-accent-hover)',
            color: 'var(--ch-color-text-primary)',
        });
        expect(palette.button.sizes).toMatchObject({
            sm: {
                minWidth: 'calc(var(--ch-space-xl) * 4)',
                padding: 'var(--ch-space-sm) 0',
            },
            md: {
                minWidth: 'calc(var(--ch-space-xl) * 5)',
                padding: 'var(--ch-space-md) 0',
            },
            lg: {
                minWidth: 'calc(var(--ch-space-xl) * 6)',
                padding: 'var(--ch-space-lg) 0',
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
