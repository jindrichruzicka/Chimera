/**
 * The blank template's example reducer, EXECUTED.
 *
 * The modules in `SIMULATION_MODULES` are token-substituted into a temp dir and
 * imported, then registered into the engine's real `ActionRegistry` — the
 * registrar a scaffolded app's `electron/main.ts` hands to the host. Nothing outside that set has to resolve:
 * whatever those modules reach for at runtime is either rendered beside them or
 * a package the repo already installs.
 *
 * What it exists to catch: an example reducer that returns the snapshot
 * unchanged. `ActionPipeline.process()` takes `reduce`'s output verbatim, so a
 * game built from such a template plays fine and records actions its own
 * replay refuses — and every adopter starts from this file.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import { createRng } from '@chimera-engine/simulation/engine/DeterministicRng.js';
import type {
    ActionDefinition,
    BaseGameSnapshot,
    GameReduceContext,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import type { ReplayFile } from '@chimera-engine/simulation/replay/ReplayFile.js';
import {
    createBaseReplayInitialSnapshot,
    ReplayPlayer,
} from '@chimera-engine/simulation/replay/ReplayPlayer.js';

import { normalizeGameName } from './normalize.js';
import { substituteTokens } from './tokens.js';

/** The name a scaffolded probe game is generated under. */
const NAMES = normalizeGameName('tick probe');
const GAME_ID = NAMES.kebab;
const PING_ACTION = `${GAME_ID}:ping`;
const P1 = playerId('player-1');

/**
 * `actions.ts` is the module under test, rendered together with the siblings its
 * import graph reaches. Dropping one that is load-bearing fails every test here
 * with a module-resolution error rather than a wrong answer.
 */
const SIMULATION_MODULES = [
    'actions.ts',
    'constants.ts',
    'action-schemas.ts',
    'action-types.ts',
] as const;

const templateSimulationDir = path.resolve(import.meta.dirname, 'templates/blank/simulation');

const renderedDirs: string[] = [];

interface RenderedTemplate {
    readonly registerActions: (registry: ActionRegistry<BaseGameSnapshot>) => void;
}

/** Token-substitute the template's simulation modules and import the result. */
async function renderTemplateSimulation(): Promise<RenderedTemplate> {
    const dir = await mkdtemp(path.join(tmpdir(), 'chimera-blank-template-'));
    renderedDirs.push(dir);

    for (const file of SIMULATION_MODULES) {
        const source = await readFile(path.join(templateSimulationDir, file), 'utf8');
        await writeFile(path.join(dir, file), substituteTokens(source, NAMES), 'utf8');
    }

    const loaded: unknown = await import(pathToFileURL(path.join(dir, 'actions.ts')).href);
    const registerActions = (loaded as Record<string, unknown>)[`register${NAMES.pascal}Actions`];
    if (typeof registerActions !== 'function') {
        throw new Error(`the rendered template exported no register${NAMES.pascal}Actions`);
    }
    return { registerActions: registerActions as RenderedTemplate['registerActions'] };
}

async function renderRegistry(): Promise<ActionRegistry<BaseGameSnapshot>> {
    const registry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(registry);
    (await renderTemplateSimulation()).registerActions(registry);
    return registry;
}

function makeSnapshot(tick: number): BaseGameSnapshot {
    return {
        tick,
        seed: 7,
        players: { [P1]: { id: P1 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: P1,
        timers: {},
        gameResult: null,
    };
}

function makeReduceContext(snapshot: BaseGameSnapshot): GameReduceContext {
    return { rng: createRng(snapshot.seed, snapshot.tick), dispatchDepth: 0 };
}

/** A one-entry recording of the example action, as a scaffolded game records it. */
function makeReplayFile(): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '1.0.0',
        gameId: GAME_ID,
        gameVersion: '0.1.0',
        gameConfig: {
            hostPlayerId: P1,
            playerIds: [P1],
            firstPlayerId: P1,
            phase: 'playing',
            initialEntities: {},
        },
        seed: 7,
        actions: [
            {
                tick: 0,
                playerId: P1,
                action: {
                    type: PING_ACTION,
                    playerId: P1,
                    tick: 0,
                    payload: { note: 'hello' },
                },
            },
        ],
        metadata: {
            recordedAt: '2026-09-02T00:00:00.000Z',
            durationTicks: 1,
            players: [{ playerId: P1, displayName: 'One' }],
        },
    };
}

afterAll(async () => {
    await Promise.all(renderedDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the blank template’s example reducer', () => {
    it('registers under the game id the template’s own constants declare', async () => {
        const registry = await renderRegistry();

        expect(registry.resolve(PING_ACTION).type).toBe(PING_ACTION);
    });

    it('advances the tick by exactly one', async () => {
        // The rule an adopter copies. A reducer that leaves the tick alone
        // records an action the engine's replay player refuses to play back.
        const registry = await renderRegistry();
        const definition = registry.resolve(PING_ACTION) as ActionDefinition<
            { readonly note: string },
            BaseGameSnapshot
        >;
        const snapshot = makeSnapshot(9);

        const next = definition.reduce(
            snapshot,
            { note: 'hello' },
            P1,
            makeReduceContext(snapshot),
        );

        expect(next.tick).toBe(10);
    });

    it('does not mutate the input snapshot', async () => {
        const registry = await renderRegistry();
        const definition = registry.resolve(PING_ACTION) as ActionDefinition<
            { readonly note: string },
            BaseGameSnapshot
        >;
        const snapshot = makeSnapshot(9);
        const before = structuredClone(snapshot);

        definition.reduce(snapshot, { note: 'hello' }, P1, makeReduceContext(snapshot));

        expect(snapshot).toEqual(before);
    });
});

describe('a scaffolded blank game’s recording', () => {
    it('replays through ReplayPlayer without a DeterminismError', async () => {
        const registry = await renderRegistry();
        const pipeline = new ActionPipeline<BaseGameSnapshot>(registry, { gameId: GAME_ID });
        const player = new ReplayPlayer(
            makeReplayFile(),
            pipeline,
            createBaseReplayInitialSnapshot,
        );

        expect(() => player.playSync()).not.toThrow();
    });

    it('lands the replayed action on the tick after the one it was recorded at', async () => {
        const registry = await renderRegistry();
        const pipeline = new ActionPipeline<BaseGameSnapshot>(registry, { gameId: GAME_ID });
        const player = new ReplayPlayer(
            makeReplayFile(),
            pipeline,
            createBaseReplayInitialSnapshot,
        );

        expect(player.initialize().tick).toBe(0);
        expect(player.step()?.tick).toBe(1);
        expect(player.step()).toBeNull();
    });
});
