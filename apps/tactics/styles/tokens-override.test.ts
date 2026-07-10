import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const overrideFilePath = fileURLToPath(new URL('./tokens-override.css', import.meta.url));

function readOverrideCss(): string {
    return readFileSync(overrideFilePath, 'utf8');
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
});
