import type { ThemeDefinition } from './types';

export const defaultTheme = {
    id: 'engine-default',
    name: 'Engine Default',
    palette: {
        button: {
            base: {
                alignItems: 'center',
                appearance: 'none',
                borderRadius: 'var(--ch-radius-sm)',
                borderStyle: 'solid',
                borderWidth: '1px',
                cursor: 'pointer',
                display: 'inline-flex',
                fontFamily: 'var(--ch-font-ui)',
                fontSize: 'var(--ch-font-size-lg)',
                fontWeight: 'var(--ch-font-weight-semibold)',
                justifyContent: 'center',
                lineHeight: 'var(--ch-line-height-tight)',
                textAlign: 'center',
                transition: 'none',
                userSelect: 'none',
            },
            variants: {
                primary: {
                    backgroundColor: 'var(--ch-color-action-primary)',
                    borderColor: 'var(--ch-color-action-primary-border)',
                    color: 'var(--ch-color-action-primary-foreground)',
                },
                secondary: {
                    backgroundColor: 'var(--ch-color-action-secondary)',
                    borderColor: 'var(--ch-color-action-secondary-border)',
                    color: 'var(--ch-color-action-secondary-foreground)',
                },
                ghost: {
                    backgroundColor: 'var(--ch-color-action-ghost)',
                    borderColor: 'var(--ch-color-action-ghost-border)',
                    color: 'var(--ch-color-action-ghost-foreground)',
                },
                danger: {
                    backgroundColor: 'var(--ch-color-action-danger)',
                    borderColor: 'var(--ch-color-action-danger-border)',
                    color: 'var(--ch-color-action-danger-foreground)',
                },
            },
            sizes: {
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
            },
        },
    },
} satisfies ThemeDefinition;
