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
                borderRadius: 'var(--ch-radius-sm)',
                borderStyle: 'solid',
                borderWidth: 'var(--ch-border-width-sm)',
                cursor: 'pointer',
                display: 'inline-flex',
                fontFamily: 'var(--ch-font-ui)',
                fontSize: 'var(--ch-font-size-lg)',
                // fontWeight: 600 — intentional bare literal; not in canonical token set per §4.35.
                // Games may not override button font-weight; contact engine team if override is needed.
                fontWeight: 600,
                justifyContent: 'center',
                // lineHeight: 1.1 — intentional bare literal; not in canonical token set per §4.35.
                // Games may not override button line-height; contact engine team if override is needed.
                lineHeight: 1.1,
                textAlign: 'center',
                transition:
                    'background-color var(--ch-duration-fast) var(--ch-easing-standard), border-color var(--ch-duration-fast) var(--ch-easing-standard), color var(--ch-duration-fast) var(--ch-easing-standard)',
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
