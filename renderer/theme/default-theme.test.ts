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
            borderRadius: 'var(--ch-radius-sm)',
            fontSize: 'var(--ch-font-size-lg)',
            fontWeight: 'var(--ch-font-weight-semibold)',
            lineHeight: 'var(--ch-line-height-tight)',
        });
        expect(palette.button.variants[variant]).toEqual({
            backgroundColor: 'var(--ch-color-action-primary)',
            borderColor: 'var(--ch-color-action-primary-border)',
            color: 'var(--ch-color-action-primary-foreground)',
        });
        expect(palette.button.sizes).toMatchObject({
            sm: {
                minWidth: 'var(--ch-button-min-width-sm)',
                padding: 'var(--ch-button-padding-sm)',
            },
            md: {
                minWidth: 'var(--ch-button-min-width-md)',
                padding: 'var(--ch-button-padding-md)',
            },
            lg: {
                minWidth: 'var(--ch-button-min-width-lg)',
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
