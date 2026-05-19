import { themeId } from './types';
import type { ThemeDefinition } from './types';

export const defaultTheme = {
    id: themeId('engine-default'),
    name: 'Engine Default',
    palette: {
        button: {
            base: {
                alignItems: 'center',
                appearance: 'none',
                borderRadius: 'var(--ch-button-radius)',
                borderStyle: 'solid',
                borderWidth: 'var(--ch-button-border-width)',
                boxShadow: 'var(--ch-button-shadow)',
                cursor: 'pointer',
                display: 'inline-flex',
                fontFamily: 'var(--ch-font-ui)',
                fontSize: 'var(--ch-font-size-lg)',
                fontWeight: 'var(--ch-button-font-weight)',
                justifyContent: 'center',
                lineHeight: 'var(--ch-button-line-height)',
                textAlign: 'center',
                transform: 'var(--ch-button-transform)',
                transition: 'var(--ch-button-transition)',
                userSelect: 'none',
            },
            variants: {
                primary: {
                    backgroundColor: 'var(--ch-color-accent)',
                    borderColor: 'var(--ch-color-accent-hover)',
                    color: 'var(--ch-color-text-primary)',
                },
                secondary: {
                    backgroundColor: 'var(--ch-color-surface-raised)',
                    borderColor: 'var(--ch-color-border)',
                    color: 'var(--ch-color-text-primary)',
                },
                ghost: {
                    // backgroundColor: 'transparent' — CSS keyword; not game-overridable via token cascade.
                    // 'transparent' is a CSS fundamental and does not appear in the §4.35 canonical token set.
                    // Games cannot override ghost button backgrounds; contact engine team if this is needed.
                    backgroundColor: 'transparent',
                    borderColor: 'var(--ch-color-border)',
                    color: 'var(--ch-color-text-secondary)',
                },
                danger: {
                    backgroundColor: 'var(--ch-color-error)',
                    borderColor: 'var(--ch-color-error)',
                    color: 'var(--ch-color-text-primary)',
                },
            },
            sizes: {
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
            },
        },
    },
} satisfies ThemeDefinition;
