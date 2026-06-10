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

function extractTokenValue(css: string, tokenName: string): string {
    const pattern = new RegExp(`${tokenName}:\\s*([^;]+);`);
    const match = css.match(pattern);

    if (match?.[1] === undefined) {
        throw new Error(`Missing token ${tokenName}`);
    }

    return match[1].trim();
}

interface HslColor {
    readonly hue: number;
    readonly saturation: number;
    readonly lightness: number;
}

function hexChannelToNumber(channel: string): number {
    return Number.parseInt(channel, 16) / 255;
}

function parseHexColor(value: string): HslColor {
    const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);

    if (!match) {
        throw new Error(`Expected a six-digit hex color token, received ${value}`);
    }

    const red = hexChannelToNumber(match[1]!);
    const green = hexChannelToNumber(match[2]!);
    const blue = hexChannelToNumber(match[3]!);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    const hue = (() => {
        if (delta === 0) return 0;
        if (max === red) return 60 * (((green - blue) / delta) % 6);
        if (max === green) return 60 * ((blue - red) / delta + 2);
        return 60 * ((red - green) / delta + 4);
    })();

    return {
        hue: hue < 0 ? hue + 360 : hue,
        saturation,
        lightness,
    };
}

function expectNeutralToken(value: string, minLightness: number, maxLightness: number): void {
    const color = parseHexColor(value);

    expect(color.saturation).toBeLessThanOrEqual(0.12);
    expect(color.lightness).toBeGreaterThanOrEqual(minLightness);
    expect(color.lightness).toBeLessThanOrEqual(maxLightness);
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
    '--ch-border-width-md',
    '--ch-border-width-lg',
    '--ch-font-ui',
    '--ch-font-ui-button',
    '--ch-font-game',
    '--ch-font-mono',
    '--ch-font-size-sm',
    '--ch-font-size-md',
    '--ch-font-size-lg',
    '--ch-font-size-xl',
    '--ch-font-weight-semibold',
    '--ch-line-height-relaxed',
    '--ch-line-height-tight',
    '--ch-button-color-primary',
    '--ch-button-color-primary-hover',
    '--ch-button-color-secondary',
    '--ch-button-color-secondary-hover',
    '--ch-button-color-ghost',
    '--ch-button-color-ghost-hover',
    '--ch-button-color-danger',
    '--ch-button-color-danger-hover',
    '--ch-button-bg-primary',
    '--ch-button-bg-primary-hover',
    '--ch-button-bg-secondary',
    '--ch-button-bg-secondary-hover',
    '--ch-button-bg-ghost',
    '--ch-button-bg-ghost-hover',
    '--ch-button-bg-danger',
    '--ch-button-bg-danger-hover',
    '--ch-button-border-primary',
    '--ch-button-border-primary-hover',
    '--ch-button-border-secondary',
    '--ch-button-border-secondary-hover',
    '--ch-button-border-ghost',
    '--ch-button-border-ghost-hover',
    '--ch-button-border-danger',
    '--ch-button-border-danger-hover',
    '--ch-button-border-width',
    '--ch-button-radius',
    '--ch-button-font-weight',
    '--ch-button-font-weight-primary',
    '--ch-button-letter-spacing',
    '--ch-button-font-size-sm',
    '--ch-button-font-size-md',
    '--ch-button-font-size-lg',
    '--ch-button-line-height-sm',
    '--ch-button-line-height-md',
    '--ch-button-line-height-lg',
    '--ch-button-shadow',
    '--ch-button-shadow-hover',
    '--ch-button-shadow-hover-danger',
    '--ch-button-transform',
    '--ch-button-transform-hover',
    '--ch-button-transform-active',
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
    '--ch-size-icon-button',
    '--ch-icon-button-size',
    '--ch-icon-button-radius',
    '--ch-icon-button-font-size',
    '--ch-icon-button-bg',
    '--ch-icon-button-bg-hover',
    '--ch-icon-button-color',
    '--ch-icon-button-border-color',
    '--ch-icon-button-border-color-hover',
    '--ch-icon-button-shadow',
    '--ch-icon-button-shadow-hover',
    '--ch-icon-button-transition',
    '--ch-toggle-button-radius',
    '--ch-toggle-button-font-size',
    '--ch-toggle-button-bg',
    '--ch-toggle-button-bg-hover',
    '--ch-toggle-button-bg-pressed',
    '--ch-toggle-button-bg-pressed-hover',
    '--ch-toggle-button-color',
    '--ch-toggle-button-color-pressed',
    '--ch-toggle-button-color-pressed-hover',
    '--ch-toggle-button-border-color',
    '--ch-toggle-button-border-color-hover',
    '--ch-toggle-button-border-color-pressed',
    '--ch-toggle-button-border-color-pressed-hover',
    '--ch-toggle-button-shadow',
    '--ch-toggle-button-shadow-hover',
    '--ch-toggle-button-padding',
    '--ch-toggle-button-transition',
    '--ch-focus-ring-width',
    '--ch-focus-ring-color',
    '--ch-focus-ring-offset',
    '--ch-select-popup-overhang-mac',
    '--ch-select-popup-shortfall-mac',
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

    it('uses a neutral engine shell palette for the default theme tokens', () => {
        const css = readTokensCss();
        const surface = extractTokenValue(css, '--ch-color-surface');
        const raised = extractTokenValue(css, '--ch-color-surface-raised');
        const overlay = extractTokenValue(css, '--ch-color-surface-overlay');
        const accent = extractTokenValue(css, '--ch-color-accent');
        const accentHover = extractTokenValue(css, '--ch-color-accent-hover');
        const textPrimary = extractTokenValue(css, '--ch-color-text-primary');
        const textSecondary = extractTokenValue(css, '--ch-color-text-secondary');
        const border = extractTokenValue(css, '--ch-color-border');

        expectNeutralToken(surface, 0.04, 0.1);
        expectNeutralToken(raised, 0.08, 0.16);
        expectNeutralToken(overlay, 0.12, 0.2);
        expectNeutralToken(accent, 0.22, 0.34);
        expectNeutralToken(accentHover, 0.28, 0.4);
        expectNeutralToken(textPrimary, 0.9, 1);
        expectNeutralToken(textSecondary, 0.55, 0.72);
        expectNeutralToken(border, 0.22, 0.34);
        expect(parseHexColor(surface).lightness).toBeLessThan(parseHexColor(raised).lightness);
        expect(parseHexColor(raised).lightness).toBeLessThan(parseHexColor(overlay).lightness);
        expect(parseHexColor(accent).lightness).toBeLessThan(parseHexColor(accentHover).lightness);
    });

    it('declares modern button shape and elevation tokens without changing palette tokens', () => {
        const css = readTokensCss();

        expect(extractTokenValue(css, '--ch-button-radius')).toBe('var(--ch-radius-md)');
        expect(extractTokenValue(css, '--ch-button-shadow')).toContain('rgba(0, 0, 0');
        expect(extractTokenValue(css, '--ch-button-shadow-hover')).toContain('rgba(128, 128, 128');
        expect(extractTokenValue(css, '--ch-button-shadow-hover-danger')).toContain(
            'rgba(220, 38, 38',
        );
        expect(extractTokenValue(css, '--ch-button-transform')).toBe('scale(1)');
        expect(extractTokenValue(css, '--ch-button-transform-hover')).toBe('scale(1.05)');
        expect(extractTokenValue(css, '--ch-color-accent')).toBe('#3f3f46');
        expect(extractTokenValue(css, '--ch-color-error')).toBe('#dc2626');
    });

    it('wires --ch-font-ui-button to the --ch-font-ui base token', () => {
        const css = readTokensCss();

        expect(extractTokenValue(css, '--ch-font-ui-button')).toBe('var(--ch-font-ui)');
    });

    it('declares the requested button size scale tokens', () => {
        const css = readTokensCss();

        expect(extractTokenValue(css, '--ch-button-font-weight')).toBe('700');
        expect(extractTokenValue(css, '--ch-button-font-weight-primary')).toBe(
            'var(--ch-button-font-weight)',
        );
        expect(extractTokenValue(css, '--ch-button-letter-spacing')).toBe('0px');
        expect(extractTokenValue(css, '--ch-button-font-size-sm')).toBe('1rem');
        expect(extractTokenValue(css, '--ch-button-font-size-md')).toBe('1.125rem');
        expect(extractTokenValue(css, '--ch-button-font-size-lg')).toBe('1.25rem');
        expect(extractTokenValue(css, '--ch-button-line-height-sm')).toBe('1.5rem');
        expect(extractTokenValue(css, '--ch-button-line-height-md')).toBe('1.75rem');
        expect(extractTokenValue(css, '--ch-button-line-height-lg')).toBe('2rem');
        expect(extractTokenValue(css, '--ch-button-padding-sm')).toBe('0.375rem 1.5rem');
        expect(extractTokenValue(css, '--ch-button-padding-md')).toBe('0.5rem 2rem');
        expect(extractTokenValue(css, '--ch-button-padding-lg')).toBe('0.75rem 2.5rem');
    });
});
