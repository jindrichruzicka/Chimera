import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const overrideFilePath = fileURLToPath(new URL('./tokens-override.css', import.meta.url));

function readOverrideCss(): string {
    return readFileSync(overrideFilePath, 'utf8');
}

function readTokenValue(css: string, token: string): string | null {
    const match = new RegExp(`${token}:\\s*([^;]+);`).exec(css);
    return match?.[1]?.trim() ?? null;
}

describe('tactics token overrides', () => {
    it('keeps the ghost button chrome-less: no background, border, or shadow overrides', () => {
        const css = readOverrideCss();

        // Ghost is a text-only button; only its text colours may be themed.
        // Redefining bg/border/shadow ghost tokens would give it a panel again.
        expect(css).not.toMatch(/--ch-button-bg-ghost[\w-]*:/);
        expect(css).not.toMatch(/--ch-button-border-ghost[\w-]*:/);
        expect(css).not.toMatch(/--ch-button-shadow-(?:hover-)?ghost:/);
    });

    it('still themes the ghost button text colours', () => {
        const css = readOverrideCss();

        expect(css).toMatch(/--ch-button-color-ghost:/);
        expect(css).toMatch(/--ch-button-color-ghost-hover:/);
    });

    it('themes keyboard focus with the tactics gold accent', () => {
        expect(readOverrideCss()).toContain('--ch-focus-ring-color: var(--ch-color-accent);');
    });

    it('keeps a muted text-secondary tier distinct from text-primary', () => {
        const css = readOverrideCss();

        const primary = readTokenValue(css, '--ch-color-text-primary');
        const secondary = readTokenValue(css, '--ch-color-text-secondary');

        expect(primary).not.toBeNull();
        expect(secondary).not.toBeNull();
        expect(secondary).not.toBe(primary);
    });

    it('keeps a real accent hover step above the accent base', () => {
        const css = readOverrideCss();

        const accent = readTokenValue(css, '--ch-color-accent');
        const accentHover = readTokenValue(css, '--ch-color-accent-hover');

        expect(accent).not.toBeNull();
        expect(accentHover).not.toBeNull();
        expect(accentHover).not.toBe(accent);
    });

    it('themes the luminous accent-strong tier for fills and spinner segments', () => {
        expect(readTokenValue(readOverrideCss(), '--ch-color-accent-strong')).not.toBeNull();
    });

    it('frosts the modal overlay: a non-zero backdrop blur over a semi-transparent scrim', () => {
        const css = readOverrideCss();

        // Tactics opts into the frosted-glass overlay by raising the blur token
        // above the engine default of 0; the scrim it sits over must stay
        // semi-transparent (an rgba with alpha < 1) so the blurred shell behind
        // the Modal actually shows through.
        const blur = readTokenValue(css, '--ch-overlay-backdrop-blur');
        expect(blur).not.toBeNull();
        expect(blur).toMatch(/^\d+(?:\.\d+)?px$/);
        expect(Number.parseFloat(blur!)).toBeGreaterThan(0);

        const backdrop = readTokenValue(css, '--ch-color-overlay-backdrop');
        expect(backdrop).not.toBeNull();
        // rgba with an alpha strictly below 1 → the scrim is see-through.
        const alpha = /rgba\([^)]*,\s*(0?\.\d+|0)\s*\)$/.exec(backdrop!);
        expect(alpha).not.toBeNull();
        expect(Number.parseFloat(alpha![1]!)).toBeLessThan(1);
    });

    it('themes the hover glows and leaves the composed button hover shadows alone', () => {
        const css = readOverrideCss();

        // The engine composes --ch-button-shadow-hover(-danger) from shadow-md
        // plus the glow tokens, so the game themes the glow, not the shadow.
        expect(readTokenValue(css, '--ch-glow-accent')).not.toBeNull();
        expect(readTokenValue(css, '--ch-glow-danger')).not.toBeNull();
        expect(css).not.toMatch(/--ch-button-shadow-hover[\w-]*:/);
    });
});
