import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tokenFilePath = fileURLToPath(new URL('./tokens.css', import.meta.url));

function readTokensCss(): string {
    return readFileSync(tokenFilePath, 'utf8');
}

function extractDeclaredTokens(css: string): readonly string[] {
    return Array.from(css.matchAll(/(--ch-[\w-]+)\s*:/g), (match) => match[1]).filter(
        (v): v is string => v !== undefined,
    );
}

const expectedTokens = [
    '--ch-color-surface',
    '--ch-color-surface-raised',
    '--ch-color-surface-overlay',
    '--ch-color-accent',
    '--ch-color-accent-hover',
    '--ch-color-text-primary',
    '--ch-color-text-secondary',
    '--ch-color-text-disabled',
    '--ch-color-border',
    '--ch-color-border-subtle',
    '--ch-color-border-muted',
    '--ch-color-success',
    '--ch-color-success-border',
    '--ch-color-success-surface',
    '--ch-color-success-surface-muted',
    '--ch-color-success-text',
    '--ch-color-success-text-strong',
    '--ch-color-warning',
    '--ch-color-warning-border',
    '--ch-color-warning-surface',
    '--ch-color-warning-text',
    '--ch-color-error',
    '--ch-color-error-border',
    '--ch-color-error-border-muted',
    '--ch-color-error-border-strong',
    '--ch-color-error-surface',
    '--ch-color-error-surface-muted',
    '--ch-color-error-surface-soft',
    '--ch-color-error-surface-strong',
    '--ch-color-error-text',
    '--ch-color-error-text-muted',
    '--ch-color-error-text-deep',
    '--ch-color-error-text-strong',
    '--ch-color-transparent',
    '--ch-space-screen-reader',
    '--ch-space-status-padding-y',
    '--ch-space-status-padding-x',
    '--ch-space-xs',
    '--ch-space-sm',
    '--ch-space-md',
    '--ch-space-lg',
    '--ch-space-xl',
    '--ch-space-none',
    '--ch-radius-sm',
    '--ch-radius-md',
    '--ch-radius-lg',
    '--ch-radius-pill',
    '--ch-border-width-sm',
    '--ch-font-ui',
    '--ch-font-game',
    '--ch-font-mono',
    '--ch-font-size-sm',
    '--ch-font-size-md',
    '--ch-font-size-lg',
    '--ch-font-size-xl',
    '--ch-font-weight-semibold',
    '--ch-line-height-tight',
    '--ch-button-border-width',
    '--ch-button-font-weight',
    '--ch-button-line-height',
    '--ch-button-transition',
    '--ch-button-min-width-sm',
    '--ch-button-min-width-md',
    '--ch-button-min-width-lg',
    '--ch-divider-length-sm',
    '--ch-divider-length-lg',
    '--ch-button-padding-sm',
    '--ch-button-padding-md',
    '--ch-button-padding-lg',
    '--ch-opacity-disabled',
    '--ch-opacity-full',
    '--ch-spinner-opacity-min',
    '--ch-cursor-disabled',
    '--ch-z-tooltip',
    '--ch-z-modal',
    '--ch-shadow-sm',
    '--ch-shadow-md',
    '--ch-shadow-lg',
    '--ch-duration-fast',
    '--ch-duration-normal',
    '--ch-duration-slow',
    '--ch-easing-standard',
] as const;

describe('renderer design tokens', () => {
    it('declares exactly the UI design system tokens from architecture section 4.35', () => {
        const declarations = extractDeclaredTokens(readTokensCss());

        expect(new Set(declarations)).toEqual(new Set(expectedTokens));
    });

    it('wires reduced motion preferences into instant linear motion tokens', () => {
        const css = readTokensCss();

        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toContain('--ch-duration-fast: 0ms;');
        expect(css).toContain('--ch-duration-normal: 0ms;');
        expect(css).toContain('--ch-duration-slow: 0ms;');
        expect(css).toContain('--ch-easing-standard: linear;');
    });
});
