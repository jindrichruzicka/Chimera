import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { InputAction } from '@chimera-engine/renderer/input';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import { SceneRegistry } from '@chimera-engine/simulation/scene/index.js';
import { tacticsAssetManifest } from '../asset-manifest.js';
import { registerTacticsScenes, TACTICS_ASSET_DEMO_SCENE_ID } from '../simulation/scenes.js';
import { TACTICS_KEYS } from '../shell/translations/keys.js';
import { TACTICS_INPUT_ACTIONS, TacticsGameScreenRegistry } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('TacticsGameScreenRegistry', () => {
    it('binds only the event audio the board does not play at explicit call sites', () => {
        // The board plays step and sword-hit POSITIONALLY at its own intent site —
        // the intent knows the acting unit, which the { type }-only GameEvent cannot
        // carry — so those entries must NOT also live here: an entry on both paths
        // would double-play every action. The exact key set is the pin.
        expect(TacticsGameScreenRegistry.eventAudioBinding).toBeDefined();
        expect(Object.keys(TacticsGameScreenRegistry.eventAudioBinding ?? {})).toEqual([
            'tactics:reveal_tile',
        ]);
    });

    it('declares every event audio ref in the tactics asset manifest', () => {
        const manifestRefs = new Set(tacticsAssetManifest.entries.map((entry) => entry.ref));
        const eventAudioRefs = Object.values(TacticsGameScreenRegistry.eventAudioBinding ?? {}).map(
            (binding) => binding.ref,
        );

        expect(eventAudioRefs).not.toHaveLength(0);
        expect(eventAudioRefs.every((ref) => manifestRefs.has(ref))).toBe(true);
    });

    it('registers a concrete summary screen for engine:post-game', () => {
        expect(TacticsGameScreenRegistry.sceneDefaultScreens?.['engine:post-game']).toBe('summary');
        expect(TacticsGameScreenRegistry.screens?.['summary']).toBeDefined();
    });

    it('code-splits the summary screen behind React.lazy (Invariant #87)', () => {
        const summary = TacticsGameScreenRegistry.screens?.['summary'];
        // React.lazy components are exotic objects, not plain functions.
        // Invariant #87: every screen exported from screens/index.ts must be
        // wrapped in React.lazy so it does not bloat the initial registry bundle.
        expect(typeof summary).toBe('object');
        expect(summary).not.toBeNull();
    });

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
        const source = readFileSync(resolve(__dirname, 'index.tsx'), 'utf8');
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

    it('registers a lazy in-game menu on inGameMenu (F55 · Invariant #87)', () => {
        const menu = TacticsGameScreenRegistry.inGameMenu;
        expect(menu).toBeDefined();
        // Not the `'none'` opt-out and not the omitted engine-default fallback.
        expect(menu).not.toBe('none');
        // React.lazy components are exotic objects, not plain functions.
        expect(typeof menu).toBe('object');
        expect(menu).not.toBeNull();
    });

    it('registers a concrete screen for the contributed asset-demo scene', () => {
        const screen = TacticsGameScreenRegistry.screens?.['asset-demo'];

        expect(screen).toBeDefined();
        // Invariant #87: registry screens are code-split behind React.lazy, so
        // the entry is an exotic object rather than a plain function.
        expect(typeof screen).toBe('object');
        expect(screen).not.toBeNull();
    });

    it('maps the contributed scene id to the screen key its descriptor declares', () => {
        // ONE fact, declared TWICE: on the descriptor as `defaultScreen` (main
        // process) and in this map (renderer). Both cover cascades now prefer a
        // value carried from the descriptor — the committed scene's on
        // `sceneDefaultScreen`, the entering scene's on
        // `SceneTransitionState.defaultScreen` — so this map is no longer what
        // rescues a contributed scene from resolving `'playfield'`.
        //
        // What the map is still the source for: the route-entry cover before ANY
        // commit or match boundary has written `sceneDefaultScreen` — a window
        // this game's OTHER entries serve, since reaching this scene requires a
        // commit that writes the key. It is also the fallback behind both
        // cascades.
        //
        // So this asserts a consistency property, not a workaround: the two
        // declarations of one screen key must not disagree, because whichever
        // one a given path reads has to name the same screen.
        const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
        registerTacticsScenes(sceneRegistry);
        const descriptor = sceneRegistry.resolve(TACTICS_ASSET_DEMO_SCENE_ID);

        expect(TacticsGameScreenRegistry.sceneDefaultScreens?.[TACTICS_ASSET_DEMO_SCENE_ID]).toBe(
            descriptor.defaultScreen,
        );
    });

    it('covers the asset-demo screen key with a static message cover', () => {
        const cover = TacticsGameScreenRegistry.loadingScreens?.['asset-demo'];

        // The `{ message }` form specifically: it is motionless, so a
        // screenshot of the cover is deterministic. A component or a spinner
        // would not be.
        expect(cover).toEqual({ message: 'game.tactics.scene.assetDemoLoading' });
    });

    it('declares a 400 ms minimum visible time for its covers', () => {
        // One registry-wide knob; the cover topology stays per-key-only, so
        // what this floors in practice is the asset-demo covers — and that
        // per-key-only shape is what keeps "covers this key and no other"
        // falsifiable below.
        expect(TacticsGameScreenRegistry.loadingScreenMinVisibleMs).toBe(400);
    });

    it('declares NO registry-wide loading cover', () => {
        // The load-bearing half of the pair: this game opts ONE screen key in,
        // and declares no fallback covering every other screen.
        expect(TacticsGameScreenRegistry.loadingScreen).toBeUndefined();
    });

    it('covers the asset-demo key and no other screen key', () => {
        // Asserts the whole keyed set, not just that `asset-demo` is present:
        // a second key added here would silently cover a screen nobody opted in.
        expect(Object.keys(TacticsGameScreenRegistry.loadingScreens ?? {})).toEqual(['asset-demo']);
    });

    it('declares its cover message in the tactics translation catalogue', () => {
        // The cover string is a translation KEY, and `t` returns an unknown key
        // unchanged — so a typo would render the raw token instead of failing.
        // This is what turns that into a test failure.
        const cover = TacticsGameScreenRegistry.loadingScreens?.['asset-demo'];
        const message =
            cover !== undefined && typeof cover === 'object' && 'message' in cover
                ? cover.message
                : undefined;

        expect(message).toBeDefined();
        expect(Object.values(TACTICS_KEYS).map(String)).toContain(message);
    });
});
