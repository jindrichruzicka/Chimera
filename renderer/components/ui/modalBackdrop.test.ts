import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Modal backdrop-blur contract: the shared Modal overlay applies a
 * token-driven `backdrop-filter` blur behind its scrim, so a game can turn the
 * plain overlay into frosted glass purely by overriding `--ch-overlay-backdrop-blur`
 * (Invariant #85). The engine default is `0` — no blur, a plain scrim — so
 * nothing changes for games that do not opt in.
 */

const rendererRoot = fileURLToPath(new URL('../..', import.meta.url));

function readRendererFile(relativePath: string): string {
    return readFileSync(join(rendererRoot, relativePath), 'utf8');
}

describe('modal backdrop blur', () => {
    it('tokens.css declares the overlay backdrop blur token defaulting to no blur', () => {
        expect(readRendererFile('styles/tokens.css')).toContain('--ch-overlay-backdrop-blur: 0;');
    });

    it('the modal overlay applies a token-driven backdrop blur', () => {
        const css = readRendererFile('components/ui/Modal.module.css');

        expect(css).toContain('backdrop-filter: blur(var(--ch-overlay-backdrop-blur))');
    });
});
