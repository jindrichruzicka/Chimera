/**
 * simulation/engine/index.test.ts
 *
 * Barrel surface contract tests — verifies that every class that forms part of
 * the public ActionPipeline contract is re-exported through the engine barrel.
 *
 * WARN-1 regression guard: ForbiddenDispatchError must be accessible from the
 * barrel so that host-side error handling in electron/main can do
 * `instanceof ForbiddenDispatchError` without importing from ActionPipeline.ts
 * directly.
 *
 * Tests written first (red) before the barrel export was added.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ForbiddenDispatchError,
    RecursiveDispatchError,
    StaleActionError,
    ActionUnauthorizedError,
    TickContractError,
    AnimationWindowManager,
    applyTimeScale,
    clearTimeScale,
} from './index.js';
import * as engineBarrel from './index.js';
import type { AnimationWindowId } from './AnimationWindow.js';
import type { BaseGameSnapshot } from './types.js';
import { entityId, gamePhase } from './types.js';

describe('simulation/engine barrel — error class exports', () => {
    it('exports ForbiddenDispatchError (WARN-1)', () => {
        const err = new ForbiddenDispatchError('test:action');
        expect(err).toBeInstanceOf(ForbiddenDispatchError);
        expect(err.code).toBe('FORBIDDEN_DISPATCH');
        expect(err.actionType).toBe('test:action');
        expect(err.message).toContain('test:action');
    });

    it('ForbiddenDispatchError instanceof chain is intact across barrel re-export', () => {
        const err = new ForbiddenDispatchError('game:move');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(ForbiddenDispatchError);
        expect(err.name).toBe('ForbiddenDispatchError');
    });

    it('RecursiveDispatchError is still exported from the barrel', () => {
        const err = new RecursiveDispatchError(16);
        expect(err).toBeInstanceOf(RecursiveDispatchError);
        expect(err.code).toBe('RECURSIVE_DISPATCH');
    });

    it('StaleActionError is still exported from the barrel', () => {
        const err = new StaleActionError(3, 5);
        expect(err).toBeInstanceOf(StaleActionError);
        expect(err.code).toBe('STALE_ACTION');
    });

    it('ActionUnauthorizedError is still exported from the barrel', () => {
        const err = new ActionUnauthorizedError('game:test', 'not_allowed');
        expect(err).toBeInstanceOf(ActionUnauthorizedError);
        expect(err.code).toBe('ACTION_UNAUTHORIZED');
    });

    it('TickContractError is still exported from the barrel', () => {
        // The Stage 5 tick-contract refusal. A host that wants to distinguish
        // it from the other pipeline throws needs it reachable here rather
        // than through a deep import of ActionPipeline.js.
        const err = new TickContractError('game:test', 4, 4);
        expect(err).toBeInstanceOf(TickContractError);
        expect(err.code).toBe('TICK_CONTRACT');
    });
});

// ─── The per-beat state layers a game reducer reaches for (F82) ───────────────

/**
 * These import `./index.js` rather than `@chimera-engine/simulation/engine`.
 * The bare specifier resolves through the package `exports` map onto
 * `simulation/dist` (`tools/vitest-resolver-plugin.ts` deliberately omits
 * `@chimera-engine/simulation` from its source map), so a test written against
 * it would be green on a stale build and blind to the source it is supposed to
 * pin. Importing the source barrel is what makes "delete an export and this
 * reds" true at the moment the export is deleted.
 */
describe('simulation/engine barrel — animation-window and time-scale verbs', () => {
    const WINDOW_ID = 'sword-hit#1' as AnimationWindowId;
    const OWNER = entityId('unit-7');

    it('is named by the @chimera-engine/simulation/engine subpath', () => {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
        ) as { exports: Record<string, { types: string; default: string }> };

        // The subpath names `dist/engine/index.js`, the build output of the
        // `engine/index.ts` these tests import. That the two correspond is the
        // build's job, not this assertion's — see `simulation/tsconfig.build.json`.
        expect(manifest.exports['./engine']?.default).toBe('./dist/engine/index.js');
        expect(manifest.exports['./engine']?.types).toBe('./dist/engine/index.d.ts');
    });

    function makeState(): BaseGameSnapshot {
        return {
            tick: 0,
            seed: 1,
            players: {},
            entities: { [OWNER]: { id: OWNER } },
            phase: gamePhase('playing'),
            events: [],
            turnNumber: 0,
            timers: {},
            gameResult: null,
        };
    }

    it('exports AnimationWindowManager, and its verbs work through the barrel', () => {
        const { next, closed } = AnimationWindowManager.open(makeState(), {
            id: WINDOW_ID,
            ownerId: OWNER,
            durationBeats: 2,
        });

        expect(closed).toEqual([]);
        expect(next.animationWindows?.[WINDOW_ID]?.remainingBeats).toBe(2);
    });

    it('exports applyTimeScale', () => {
        expect(applyTimeScale(makeState(), { permille: 250 }).timeScalePermille).toBe(250);
    });

    it('exports clearTimeScale', () => {
        const dilated = applyTimeScale(makeState(), { permille: 250 });

        expect(clearTimeScale(dilated).timeScalePermille).not.toBe(250);
    });

    it('does not re-export advanceTimeScale', () => {
        // `advanceTimeScale` is the dilation half of the per-beat sweep, which
        // this barrel deliberately does not name. The module's own subpath
        // still resolves it — this measures the barrel only.
        expect('advanceTimeScale' in engineBarrel).toBe(false);

        // Control: the two verbs that ARE public are visible through the same
        // namespace object, so the assertion above is discriminating rather
        // than true of every name.
        expect('applyTimeScale' in engineBarrel).toBe(true);
        expect('clearTimeScale' in engineBarrel).toBe(true);
        expect('AnimationWindowManager' in engineBarrel).toBe(true);
    });
});
