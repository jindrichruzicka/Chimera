/**
 * renderer/game/__tests__/game-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/game/index.ts` makes about itself, none of which
 * any other artifact checks.
 *
 * **The exported surface.** `package-exports-contract.test.ts` pins the
 * package's `exports` MAP, never what the barrel behind it exports. Removing a
 * symbol from the re-export block is a breaking change to a published package,
 * and typecheck catches only the ones this repo happens to consume through the
 * barrel — so the runtime names are pinned as a closed set below, and the types
 * by `BarrelTypeSurface`, which catches a removal but not an addition.
 *
 * **What a game may NOT write.** §4.37.18 gives a game exactly one shell-state
 * writer, `setShellDraft`; `surface`, `pathname`, `gameId` and `transition` are
 * written by enumerated engine sites only. The non-member list is DERIVED from
 * the store module's own exports rather than typed out here, matched on the
 * verb prefixes the writers use today — a writer named outside that shape is
 * not covered.
 *
 * **What it drags in.** The barrel is re-export only, but not import-inert: the
 * page services reach the renderer state stores in the list below, whose
 * module-level singletons are eager, so importing it constructs them. That is a real cost paid at the
 * consumer app's renderer composition root, which imports this barrel as a
 * module-eval side effect — so the set is EXHAUSTIVE, not a denylist, and a new
 * edge into any subsystem is a failure to look at rather than a silent growth.
 * What this measures is the import GRAPH: a side effect added inside a module
 * already in the set changes no edge and would pass here.
 *
 * Mechanism mirrors `renderer/audio/__tests__/audio-barrel-side-effects.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

import { analyze, GAME_DIR } from './gameGraph.js';
import * as gameBarrel from '../index';
import * as shellStateStore from '../../shell/shellStateStore';
import type {
    GameTranslations,
    LoadedRendererGame,
    LoadedRendererGameShell,
    QuickStartControls,
    RendererGameContribution,
    RendererGameLoader,
    RendererGameShellLoader,
    ShellNavigate,
    ShellState,
    ShellSurface,
    ShellTransition,
    ShellTransitionKind,
} from '../index';

/**
 * The barrel's TYPE surface, held by naming every member of it.
 *
 * Types leave no runtime trace, so the symbol-set assertion below cannot see
 * them, and most have no consumer through the barrel to red on their removal.
 * Dropping one is a breaking change to a published package that would otherwise
 * compile, ship, and fail only in an adopter's build. Naming each here makes
 * `pnpm typecheck` the gate that catches it.
 */
interface BarrelTypeSurface {
    readonly translations: GameTranslations;
    readonly loadedGame: LoadedRendererGame;
    readonly loadedShell: LoadedRendererGameShell;
    readonly quickStart: QuickStartControls;
    readonly contribution: RendererGameContribution;
    readonly gameLoader: RendererGameLoader;
    readonly shellLoader: RendererGameShellLoader;
    readonly navigate: ShellNavigate;
    readonly shellState: ShellState;
    readonly surface: ShellSurface;
    readonly transition: ShellTransition;
    readonly transitionKind: ShellTransitionKind;
}

/** A forbidden external is the named runtime or any of its subpaths. */
function importsRuntime(externals: readonly string[], name: string): boolean {
    return externals.some((spec) => spec === name || spec.startsWith(`${name}/`));
}

describe('@chimera-engine/renderer/game barrel', () => {
    it('exports exactly the documented public surface', () => {
        // Referencing the type roll-call keeps it from reading as unused; the
        // assertion that matters for it is made by tsc, not here.
        const typeSurface: BarrelTypeSurface | undefined = undefined;
        expect(typeSurface).toBeUndefined();

        // Sorted and exhaustive on purpose: an ADDITION is as reportable as a
        // removal, since every name here becomes public API of a published
        // package the moment it lands.
        expect(Object.keys(gameBarrel).sort()).toEqual([
            'GAME_SHELL_WARMUP_BUDGET_MS',
            'UnknownRendererGameError',
            'getRendererGameMenuCommand',
            'getShellState',
            'loadRendererGame',
            'loadRendererGameShell',
            'registerRendererGame',
            'setShellDraft',
            'useQuickStart',
            'useShellNavigate',
            'useShellState',
        ]);
    });

    it('publishes setShellDraft as the ONLY shell-state writer a game can reach', () => {
        // Derived from the store's own exports rather than listed here, matched
        // on the verb prefixes the writers use today.
        const storeWriters = Object.keys(shellStateStore).filter((name) =>
            /^(?:set|arm|clear|create|_reset)/u.test(name),
        );
        const reachable = storeWriters.filter((name) => name in gameBarrel);

        expect(storeWriters.length).toBeGreaterThan(1);
        expect(reachable).toEqual(['setShellDraft']);
    });

    it('publishes no handle on the store itself, which would bypass the writer list', () => {
        expect(gameBarrel).not.toHaveProperty('shellStateStore');
        expect(gameBarrel).not.toHaveProperty('createShellStateStore');
    });

    it('keeps the registry test reset out of the published surface', () => {
        // A curated re-export rather than the registry module itself is what
        // makes the `_` prefix mean anything: mapping the subpath at the module
        // would publish this.
        expect(gameBarrel).not.toHaveProperty('_resetRendererGameRegistryForTest');
    });

    it('pulls in a closed set of modules, several of them stores', async () => {
        const { inputs, externals } = await analyze(resolve(GAME_DIR, 'index.ts'));

        // Full repo-relative paths: the analyzer pins what they are relative TO,
        // so a single-file run and `pnpm -r test` report the same spelling.
        expect([...inputs].sort()).toEqual([
            'renderer/assets/AssetPreloader.ts',
            'renderer/assets/AssetResolver.ts',
            'renderer/bridge/useLeaveGame.ts',
            'renderer/components/scene/scenePreload.ts',
            'renderer/components/shell/screenFadeDuration.ts',
            'renderer/game/GameFontLoader.ts',
            'renderer/game/GameImageWarmup.ts',
            'renderer/game/gameCursorStyles.ts',
            'renderer/game/gameShellAssetSource.ts',
            'renderer/game/index.ts',
            'renderer/game/rendererGameRegistry.ts',
            'renderer/hooks/useQuickStart.ts',
            'renderer/hooks/useSavesApi.ts',
            'renderer/logging/rendererLogger.ts',
            'renderer/shell/matchEntryVerbs.ts',
            'renderer/shell/resolveMainMenuGameId.ts',
            'renderer/shell/shellStateStore.ts',
            'renderer/shell/useShellNavigate.ts',
            'renderer/state/gameStore.ts',
            'renderer/state/lobbyStore.ts',
            'renderer/state/lobbyUiStore.ts',
            'renderer/state/saveStore.ts',
        ]);

        // The registration seam runs at the consumer app's renderer composition
        // root, which is client-bundle module evaluation — so a heavy runtime
        // reached from here would be paid by every game on every load. Heavy
        // runtimes are externalized rather than bundled, so they never appear as
        // inputs and are checked separately.
        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/electron')).toBe(false);
    });

    it('reaches no shell COMPONENT — the barrel publishes services, never a mount', async () => {
        const { inputs } = await analyze(resolve(GAME_DIR, 'index.ts'));

        expect(inputs.filter((path) => path.startsWith('renderer/app/'))).toEqual([]);
        expect(inputs.filter((path) => path.endsWith('.tsx'))).toEqual([]);
    });
});
