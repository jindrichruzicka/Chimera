import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InputAction } from '@chimera-engine/renderer/input';
import { TACTICS_INPUT_ACTIONS } from './input-actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('TACTICS_INPUT_ACTIONS', () => {
    it('names the public input barrel from the game surface itself', () => {
        // Tactics is the in-repo ADOPTER of `@chimera-engine/renderer/input`
        // (§4.26): a real game surface naming the barrel through the real lint
        // zone and the real tsc project, rather than a synthetic RuleTester case
        // or a tarball probe. The import is type-only, so it erases before any
        // bundler resolves it — `verify-scaffold`'s seam plant is what names the
        // barrel at value level, and it does so in a generated app resolving
        // through the packed `exports` map. Measured: reverting the file to a bare `as const`
        // with the import dropped keeps `tsc -p apps/tactics/tsconfig.json`, the
        // invariant checker and every other case in this file green — `as const`
        // still satisfies `readonly InputAction[]` where `apps/tactics/renderer/loaders.ts`
        // reads it. This assertion is what fails.
        const source = readFileSync(resolve(__dirname, 'input-actions.ts'), 'utf8');
        const specifiers = [...source.matchAll(/^import[^;]*?from '([^']+)';$/gmu)].map(
            (match) => match[1],
        );
        expect(specifiers).toContain('@chimera-engine/renderer/input');
    });

    it('declares its rebindable actions against the public input barrel type', () => {
        // Holding the barrel's `InputAction` here means a barrel that stopped
        // exporting the type fails `pnpm typecheck` in the GAME package.
        const held: readonly InputAction[] = TACTICS_INPUT_ACTIONS;

        // Inline literals, not a re-derivation from the table: the ids and
        // tokens the Controls panel and the engine's registration seam read.
        expect(held).toEqual([
            {
                id: 'game:end-turn',
                description: 'game.tactics.actions.endTurn',
                category: 'game.tactics.actions.categoryGame',
                oneShot: true,
            },
        ]);
    });
});
