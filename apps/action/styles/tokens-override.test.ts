import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const overrideFilePath = fileURLToPath(new URL('./tokens-override.css', import.meta.url));
const enginePath = fileURLToPath(new URL('../../../renderer/styles/tokens.css', import.meta.url));

function readOverrideCss(): string {
    return readFileSync(overrideFilePath, 'utf8');
}

/** Every `--ch-*` name the override file REDEFINES (declarations, not references). */
function declaredTokens(css: string): readonly string[] {
    return [...css.matchAll(/^\s*(--ch-[\w-]+)\s*:/gmu)].map((match) => match[1] ?? '');
}

describe('action token overrides', () => {
    it('redefines only the accent family', () => {
        // The exact set, not a count: the family is read by several components,
        // so a member dropped from it themes part of the UI and not the rest.
        expect(declaredTokens(readOverrideCss())).toEqual([
            '--ch-color-accent',
            '--ch-color-accent-hover',
            '--ch-color-accent-strong',
        ]);
    });

    it('redefines only tokens the engine actually declares', () => {
        // The property `chimera/no-unknown-token-overrides` enforces, asserted
        // here against the engine's own stylesheet so it holds even where the
        // rule is not running (an editor, a partial lint invocation).
        const engineTokens = new Set(declaredTokens(readFileSync(enginePath, 'utf8')));

        for (const token of declaredTokens(readOverrideCss())) {
            expect(engineTokens.has(token), token).toBe(true);
        }
    });

    it('would reject a token the engine does not declare (positive control)', () => {
        // Without this the check above is a loop that could be reading an empty
        // engine token set and still pass.
        const engineTokens = new Set(declaredTokens(readFileSync(enginePath, 'utf8')));

        expect(engineTokens.size).toBeGreaterThan(0);
        expect(engineTokens.has('--ch-color-accent')).toBe(true);
        expect(engineTokens.has('--ch-color-invented-by-a-game')).toBe(false);
    });
});
