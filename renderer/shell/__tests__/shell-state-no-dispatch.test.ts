/**
 * renderer/shell/__tests__/shell-state-no-dispatch.test.ts
 *
 * The shell-state discipline: reading or reacting to the shell state reaches
 * nothing authoritative. A background dollying on a route change, a page
 * reading the draft, a hook hopping between shell routes — none of them opens
 * an IPC channel, advances a tick or dispatches an `EngineAction`. This guard
 * deliberately names no invariant number: the roll-call row points AT it, so
 * the citation lives in one place rather than two.
 *
 * The claim is held by the SHAPE of the surface rather than by review, and
 * pinning a shape needs two reads, because each is blind where the other sees.
 *
 * 1. **What a reader is HANDED at runtime.** The published state, driven
 *    through every writer the store has, with its key set asserted EXACTLY and
 *    every value — nested ones included — asserted to be plain data. A
 *    dispatcher smuggled onto the state would be a new key, and only an exact
 *    set notices one: `not.toHaveProperty('dispatch')` passes for `sendAction`,
 *    `emit`, `ctx` and every other name. A dispatcher smuggled in as a VALUE on
 *    an existing key is what the plain-data half catches.
 * 2. **What the surface DECLARES.** Types erase, so nothing at runtime can see
 *    a dispatcher added to a hook's parameter list or to the bridge's props.
 *    That half is a source read over `OWNING_MODULES` — the store that declares
 *    the state, the bridge that is its only route writer, and the navigation
 *    hook that is the renderer-local hop a game reaches for. A module joining
 *    that surface joins this list — and the list itself is pinned against two
 *    independent sources (the route-classification census and the game barrel),
 *    because dropping an entry from a literal narrows the scan silently.
 *
 * Neither half is a lint rule, deliberately: the rule's own claim is that the
 * shape is the enforcement, and a lint rule is something someone can disable.
 *
 * Mechanism mirrors `renderer/audio/__tests__/cue-handler-no-dispatch.test.ts`,
 * which holds the cue-observation half.
 *
 * Tests written first (TDD — red confirmed by mutation, both halves: a
 * `readonly report: () => void` field added to `ShellState` and written by
 * `setShellRoute` fails the runtime arm on the exact-key conjunct AND on the
 * plain-data one; naming `SendAction` in `useShellNavigate.ts` fails the source
 * arm for that module alone; dropping EITHER the navigation hook or the bridge
 * from `OWNING_MODULES` fails the derived-set conjunct).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
    _resetShellStateForTest,
    armShellTransition,
    getShellState,
    setShellDraft,
    setShellRoute,
    type ShellState,
} from '../shellStateStore.js';
import { SHELL_STATE_FILE, SOLE_CLASSIFIER } from './routeClassificationCensus.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_ROOT = path.resolve(here, '..', '..');

/** Every key the published shell state is allowed to carry. */
const ALLOWED_KEYS: readonly string[] = ['surface', 'pathname', 'gameId', 'transition', 'draft'];

/**
 * Every value reachable from `state`, walking into the plain objects it nests
 * (`transition`, `draft`) rather than stopping at the top level — a dispatcher
 * parked one level down would satisfy a shallow scan.
 */
function reachableValues(state: unknown): readonly unknown[] {
    if (state === null || typeof state !== 'object') return [state];
    return Object.values(state).flatMap((value) => [value, ...reachableValues(value)]);
}

describe('the published shell state carries no dispatcher', () => {
    beforeEach(() => {
        _resetShellStateForTest();
    });

    /**
     * Drive every writer the store publishes, so the census below reads a state
     * in which no field is still holding its initial value. Returns the state
     * every writer has touched.
     */
    function fullyWrittenState(): ShellState {
        setShellRoute({ surface: 'page', pathname: '/codex', gameId: 'tactics' });
        armShellTransition({ kind: 'to-match', durationMs: 320 });
        setShellDraft({ matchSettings: { difficulty: 'hard' }, aiSeats: [{}] });
        return getShellState();
    }

    it('reaches past every initial value, so the census below is not vacuous', () => {
        // The floor. The initial state is `boot` / `'/'` / `null` / `null` / `{}`
        // — four of its five fields hold no nested value at all, so a census
        // taken on it would satisfy the plain-data conjunct having walked
        // nothing.
        const state = fullyWrittenState();

        expect(state.surface).not.toBe('boot');
        expect(state.pathname).not.toBe('/');
        expect(state.gameId).not.toBeNull();
        expect(state.transition).not.toBeNull();
        expect(Object.keys(state.draft)).not.toHaveLength(0);
    });

    it('carries NO key beside the declared ones', () => {
        const state = fullyWrittenState();

        expect(Object.keys(state).filter((key) => !ALLOWED_KEYS.includes(key))).toEqual([]);
        // Exhaustive in the other direction too: a field dropped from the state
        // is a change to what a game reads, and this list is the roll-call of it.
        expect(Object.keys(state).sort()).toEqual([...ALLOWED_KEYS].sort());
    });

    it('publishes plain data throughout, with no function riding on any field', () => {
        // A dispatcher smuggled in as a VALUE rather than as a new key — an
        // existing field retyped — passes the exact-key census above. The walk
        // descends into `transition` and `draft`, so a callback parked on a
        // nested object is caught too.
        const values = reachableValues(fullyWrittenState());

        expect(values.filter((value) => typeof value === 'function')).toEqual([]);
        expect(values.length).toBeGreaterThan(ALLOWED_KEYS.length);
    });
});

describe('the shell-state surface DECLARES no dispatcher', () => {
    /**
     * Every module that owns part of the shell-state surface, repo-relative to
     * `renderer/`: the store that declares the state and its writers, the
     * bridge that is its sole route writer, and the game-facing navigation hook
     * whose whole claim is that the hop is renderer-local.
     */
    const OWNING_MODULES = [
        'shell/shellStateStore.ts',
        'shell/useShellNavigate.ts',
        'components/shell/ShellStateBridge.tsx',
    ] as const;

    /** The one that DECLARES the state; the others read or write it. */
    const DECLARING_MODULE = 'shell/shellStateStore.ts';

    /**
     * The names a shell-state module may not reach for. Assembled at runtime so
     * this file never becomes its own match if the scan is ever widened to the
     * census itself.
     */
    const FORBIDDEN = [
        `Send${'Action'}`,
        `Engine${'Action'}`,
        `dis${'patch'}`,
        `Player${'Id'}`,
        `ti${'ck'}`,
        `__chi${'mera'}`,
    ] as const;

    /**
     * A real module that reaches each forbidden name, keyed by the name.
     *
     * `FORBIDDEN` is a literal, and the `namedDispatchApis` fixtures below pass
     * their OWN arrays, so nothing else reads it: a name deleted from it would
     * leave every case green while the census quietly stopped looking for that
     * reach. Pinning the two lists against each other anchors the list to the
     * tree — each control is a module that genuinely names its key, so one
     * cannot be invented to satisfy the pin — and it doubles as the positive
     * control showing the scan sees a REAL reach and not only a fixture. Each
     * control names its key in code rather than in passing: `useSendAction.ts`
     * takes the action types and reaches the preload bridge, `InputManager.ts`
     * declares a `dispatchEvent`, `GameStoreBootstrap.tsx` reads the local
     * player id, and `gameStore.ts` carries the snapshot tick.
     */
    const REACH_CONTROLS: Readonly<Record<string, string>> = {
        [`Send${'Action'}`]: 'bridge/useSendAction.ts',
        [`Engine${'Action'}`]: 'bridge/useSendAction.ts',
        [`dis${'patch'}`]: 'input/InputManager.ts',
        [`Player${'Id'}`]: 'app/GameStoreBootstrap.tsx',
        [`ti${'ck'}`]: 'state/gameStore.ts',
        [`__chi${'mera'}`]: 'bridge/useSendAction.ts',
    };

    it('forbids exactly the names a control module is named for', () => {
        expect([...FORBIDDEN].sort()).toEqual(Object.keys(REACH_CONTROLS).sort());
    });

    it.each(Object.entries(REACH_CONTROLS))(
        'reports %s on a module that really reaches it',
        (name, control) => {
            const source = codeOf(readFileSync(path.join(RENDERER_ROOT, control), 'utf8'));

            expect(namedDispatchApis(source, FORBIDDEN)).toContain(name);
        },
    );

    it('lists exactly the modules that own the surface, derived rather than typed', () => {
        // `OWNING_MODULES` is a literal, so dropping an entry narrows the scan
        // silently: every remaining case still passes, and a module that owns
        // part of the surface walks out of the census. The expected set is therefore
        // rebuilt from two independent sources — the route-classification
        // census, which names the store and the sole route writer, and the game
        // barrel, which names the module it publishes `useShellNavigate` from.
        const barrel = readFileSync(path.join(RENDERER_ROOT, 'game', 'index.ts'), 'utf8');
        const navigateFrom = /export\s*\{[^}]*\buseShellNavigate\b[^}]*\}\s*from\s*'([^']+)'/u.exec(
            barrel,
        )?.[1];

        expect(navigateFrom, 'the game barrel no longer publishes useShellNavigate').toBeDefined();

        const rendererRelative = (repoRelative: string): string =>
            repoRelative.replace(/^renderer\//u, '');
        const expected = [
            rendererRelative(SHELL_STATE_FILE),
            rendererRelative(SOLE_CLASSIFIER),
            (navigateFrom ?? '').replace(/^\.\.\//u, '').replace(/\.js$/u, '.ts'),
        ].sort();

        expect([...OWNING_MODULES].sort()).toEqual(expected);
    });

    it.each(OWNING_MODULES)('names no dispatch API anywhere in %s', (moduleName) => {
        const source = codeOf(readFileSync(path.join(RENDERER_ROOT, moduleName), 'utf8'));

        // Three floors against a scan that could pass for the wrong reason: the
        // module must still carry declarations after stripping; it must still
        // NAME the store, or the scan would stay green the day its part of the
        // surface moved somewhere unlisted; and the phrase a module header uses
        // to SAY it holds this rule must not survive into what is scanned, or a
        // header would satisfy its own scan.
        expect(source).toMatch(/export (interface|type|const|function)/u);
        expect(source).toContain('shellStateStore');
        expect(source).not.toContain('advances no tick');

        expect(namedDispatchApis(source, FORBIDDEN)).toEqual([]);
    });

    it('reads the module the state is declared in', () => {
        // The scan above accepts a module that merely NAMES the store, which
        // every consumer does. Without this, the list could lose its declaration
        // site and go on passing on consumers of a state nothing here reads.
        const source = codeOf(readFileSync(path.join(RENDERER_ROOT, DECLARING_MODULE), 'utf8'));

        expect(OWNING_MODULES).toContain(DECLARING_MODULE);
        expect(source).toMatch(/export interface ShellState/u);
    });

    describe('codeOf', () => {
        it('drops a block comment', () => {
            expect(codeOf('/* a dispatcher */ const x = 1;')).toBe(' const x = 1;');
        });

        it('drops a line comment', () => {
            expect(codeOf('const x = 1; // a dispatcher\nconst y = 2;')).toBe(
                'const x = 1; \nconst y = 2;',
            );
        });

        it('keeps a protocol-relative URL, whose // is not a comment', () => {
            expect(codeOf("const u = 'https://example.test/a';")).toContain('example.test');
        });
    });

    describe('namedDispatchApis', () => {
        it('reports every forbidden name a source carries, case-folded', () => {
            expect(namedDispatchApis('DISPATCH(x); const t = TICK;', ['dispatch', 'tick'])).toEqual(
                ['dispatch', 'tick'],
            );
        });

        it('reports the exact matched set, not a count', () => {
            expect(namedDispatchApis('const t = tick;', ['dispatch', 'tick'])).toEqual(['tick']);
        });

        it('reports nothing for a source that names none of them', () => {
            expect(namedDispatchApis('const x = 1;', ['dispatch', 'tick'])).toEqual([]);
        });
    });
});

/**
 * The forbidden names `source` carries, in the order they were probed. Reported
 * as a SET rather than as a boolean so a failure names which API was reached,
 * and case-folded because `dispatch`, `Dispatch` and `DISPATCH` are the same
 * reach.
 */
function namedDispatchApis(source: string, forbidden: readonly string[]): readonly string[] {
    const haystack = source.toLowerCase();
    return forbidden.filter((name) => haystack.includes(name.toLowerCase()));
}

/**
 * `source` with block and line comments removed, so the scan reads CODE rather
 * than the prose explaining why there is none.
 *
 * Crude in a known direction: it has no notion of string or regex literals, so
 * a `//` inside one is eaten and a `/*` inside one eats forward to the next
 * close. The floors above are what catch a strip that removed real
 * declarations, in whichever module of the list it happened.
 */
function codeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}
