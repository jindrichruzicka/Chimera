/**
 * simulation/foundation/game-screen-contract.test.ts
 *
 * Type-level and runtime unit tests for the game-screen contract's optional
 * slots and the props handed to the components that fill them: the in-game menu
 * (`GameScreenRegistry.inGameMenu` / `InGameMenuProps`), the widened transition
 * overlay (`TransitionOverlayProps`), and the loading-cover vocabulary
 * (`SceneLoadingReason`, `GameLoadingScreenProps`, `GameLoadingScreen` and the
 * two `loadingScreen` / `loadingScreens` slots).
 *
 * Architecture reference: §4.33–§4.36 — GameScreenRegistry / GameShell
 *
 * Invariants upheld:
 *   #80 — the in-game menu is supplied only via `GameScreenRegistry`; the slot is
 *     just a `GameScreenComponent`, so `GameShell` never imports `apps/*`.
 *   #81 — `playfield` remains the only required slot; `inGameMenu`,
 *     `loadingScreen` and `loadingScreens` are optional (a registry providing
 *     only `playfield` type-checks).
 *   §3 Module Boundary — `simulation/` must not import from `renderer/`, `apps/*`,
 *     or `electron/main`.
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import type { PlayerId } from './engine-contract.js';
import type { PlayerSnapshot } from './snapshot-contract.js';
import type {
    GameLoadingImage,
    GameLoadingMessage,
    GameLoadingScreen,
    GameLoadingScreenProps,
    GameScreenComponent,
    GameScreenProps,
    GameScreenRegistry,
    InGameMenuProps,
    SceneLoadingReason,
    SendAction,
    TransitionOverlayProps,
} from './game-screen-contract.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

// `PlayerId` is a branded type at the preload boundary; a bare string literal is
// not assignable. Cast rather than import simulation's `playerId()` helper, which
// would be a runtime import crossing out of the foundation leaf (§3).
const localPlayerId = 'p1' as unknown as PlayerId;

const playfield: GameScreenComponent<GameScreenProps> = () => null;

// The overlay cases below assert the SHAPE of the props object, never snapshot
// content, so an empty cast stands in for the rich projection rather than
// hand-building its ten required fields.
const snapshot = {} as PlayerSnapshot;
const sendAction: SendAction = () => undefined;

function InGameMenu(props: InGameMenuProps): React.ReactElement | null {
    void props;
    return null;
}

const LazyInGameMenu: React.LazyExoticComponent<React.ComponentType<InGameMenuProps>> = React.lazy(
    () => Promise.resolve({ default: InGameMenu }),
);

function LoadingCover(props: GameLoadingScreenProps): React.ReactElement | null {
    void props;
    return null;
}

const LazyLoadingCover: React.LazyExoticComponent<React.ComponentType<GameLoadingScreenProps>> =
    React.lazy(() => Promise.resolve({ default: LoadingCover }));

const coverProps: GameLoadingScreenProps = {
    screenKey: 'playfield',
    sceneId: 'engine:game',
    reason: 'assets',
    progress: null,
};

// ─── InGameMenuProps ──────────────────────────────────────────────────────────

describe('InGameMenuProps', () => {
    it('accepts a fully-typed props object and invokes its void callbacks', () => {
        const calls: string[] = [];
        const props: InGameMenuProps = {
            closeMenu: () => calls.push('close'),
            leaveGame: () => calls.push('leave'),
            isHost: true,
            localPlayerId,
        };

        props.closeMenu();
        props.leaveGame();

        expect(calls).toEqual(['close', 'leave']);
        expect(props.isHost).toBe(true);
        expect(props.localPlayerId).toBe('p1');
    });

    it('treats localPlayerId as optional (props without it type-check)', () => {
        const props: InGameMenuProps = {
            closeMenu: () => undefined,
            leaveGame: () => undefined,
            isHost: false,
        };
        expect(props.localPlayerId).toBeUndefined();
    });

    it('rejects a props object missing the required isHost field at compile time', () => {
        // @ts-expect-error: isHost is required and is omitted here
        const _: InGameMenuProps = {
            closeMenu: () => undefined,
            leaveGame: () => undefined,
        };
        expect(_).toBeDefined();
    });
});

// ─── GameScreenRegistry.inGameMenu slot ───────────────────────────────────────

describe('GameScreenRegistry.inGameMenu', () => {
    it('is optional — a registry providing only playfield is valid (Invariant #81)', () => {
        const registry: GameScreenRegistry = { playfield };
        expect(registry.inGameMenu).toBeUndefined();
    });

    it('accepts a plain React component override (GameScreenComponent)', () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: InGameMenu };
        expect(registry.inGameMenu).toBe(InGameMenu);
    });

    it('accepts a React.lazy component override (LazyExoticComponent)', () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: LazyInGameMenu };
        expect(registry.inGameMenu).toBe(LazyInGameMenu);
    });

    it("accepts the 'none' opt-out sentinel", () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: 'none' };
        expect(registry.inGameMenu).toBe('none');
    });

    it('rejects an unknown string sentinel at compile time', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: 'off' is not a valid inGameMenu sentinel (only 'none')
            inGameMenu: 'off',
        };
        expect(registry.inGameMenu).toBe('off');
    });

    it('rejects a component whose props are incompatible with InGameMenuProps', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: a component requiring an unrelated prop is not assignable
            inGameMenu: (props: { gameResult: string }) => {
                void props;
                return null;
            },
        };
        expect(registry.inGameMenu).toBeDefined();
    });
});

// ─── SceneLoadingReason ───────────────────────────────────────────────────────

describe('SceneLoadingReason', () => {
    it('names the two waits a cover can stand in for, and no others', () => {
        // A `Record` keyed by the union is exhaustive both ways: a third member
        // reds as a missing property, and a removed one reds as an excess key.
        // A `SceneLoadingReason[]` literal would compare with itself and see
        // neither.
        const rendered: Record<SceneLoadingReason, string> = {
            assets: 'loading assets',
            code: 'loading screen module',
        };

        expect(Object.keys(rendered)).toEqual(['assets', 'code']);
    });

    it("rejects 'chunk' — the foundation names no bundler concept it cannot observe", () => {
        // @ts-expect-error: the reason is REPORTED to a cover by the renderer, and
        // `simulation/foundation` observes no bundler; 'code' is the engine-side
        // name for a screen module that has not resolved yet.
        const reason: SceneLoadingReason = 'chunk';
        expect(reason).toBe('chunk');
    });
});

// ─── GameLoadingScreenProps ───────────────────────────────────────────────────

describe('GameLoadingScreenProps', () => {
    it('carries the cover identity, the wait it stands in for, and its progress', () => {
        expect(coverProps.screenKey).toBe('playfield');
        expect(coverProps.sceneId).toBe('engine:game');
        expect(coverProps.reason).toBe('assets');
        expect(coverProps.progress).toBeNull();
    });

    it('accepts a measured progress fraction', () => {
        const props: GameLoadingScreenProps = { ...coverProps, reason: 'code', progress: 0.5 };
        expect(props.progress).toBe(0.5);
    });

    it('withholds snapshot — a cover stands in for a screen that is not mountable yet', () => {
        // @ts-expect-error: during a transition the snapshot is still the PRE-commit
        // one, so a cover is given none rather than a misleading one.
        expect(coverProps.snapshot).toBeUndefined();
    });

    it('withholds sendAction — the missing parameter IS the prohibition', () => {
        // @ts-expect-error: a cover must not dispatch.
        expect(coverProps.sendAction).toBeUndefined();
    });

    it('requires progress rather than letting it default to 0', () => {
        // @ts-expect-error: `progress` is required and nullable. This is the killer
        // for making it optional (or `number` with a 0 default) — a bar reading 0%
        // for something nobody measured is a lie the engine will not author.
        const props: GameLoadingScreenProps = {
            screenKey: 'playfield',
            sceneId: 'engine:game',
            reason: 'assets',
        };
        expect(props).toBeDefined();
    });

    // One literal per omitted field rather than one omitting all four: a fixture
    // that trips every requirement at once leaves each drop-one mutant alive.

    it('requires screenKey', () => {
        // @ts-expect-error: a cover has to know which screen key it stands in for.
        const props: GameLoadingScreenProps = {
            sceneId: 'engine:game',
            reason: 'assets',
            progress: null,
        };
        expect(props).toBeDefined();
    });

    it('requires sceneId', () => {
        // @ts-expect-error: a cover has to know which scene it is shown inside.
        const props: GameLoadingScreenProps = {
            screenKey: 'playfield',
            reason: 'assets',
            progress: null,
        };
        expect(props).toBeDefined();
    });

    it('requires reason', () => {
        // @ts-expect-error: which wait the cover stands in for is what a game
        // renders differently; there is no default that is right for both.
        const props: GameLoadingScreenProps = {
            screenKey: 'playfield',
            sceneId: 'engine:game',
            progress: null,
        };
        expect(props).toBeDefined();
    });
});

// ─── GameScreenRegistry loading-cover slots ───────────────────────────────────

describe('GameScreenRegistry loading-cover slots', () => {
    it('are optional — a registry providing only playfield is valid (Invariant #81)', () => {
        // The killer for making either new slot required: a `playfield`-only
        // literal stops satisfying `GameScreenRegistry`.
        const registry: GameScreenRegistry = { playfield };
        expect(registry.loadingScreen).toBeUndefined();
        expect(registry.loadingScreens).toBeUndefined();
    });

    it('accept a plain component', () => {
        const registry: GameScreenRegistry = { playfield, loadingScreen: LoadingCover };
        expect(registry.loadingScreen).toBe(LoadingCover);
    });

    it('accept a React.lazy component', () => {
        const registry: GameScreenRegistry = { playfield, loadingScreen: LazyLoadingCover };
        expect(registry.loadingScreen).toBe(LazyLoadingCover);
    });

    it('accept the static { message } form', () => {
        const registry: GameScreenRegistry = {
            playfield,
            loadingScreen: { message: 'chimera.loading.assets' },
        };
        expect(registry.loadingScreen).toEqual({ message: 'chimera.loading.assets' });
    });

    it('accept the static { image } form without an alt', () => {
        const registry: GameScreenRegistry = {
            playfield,
            loadingScreen: { image: 'chimera://tactics/ui/loading.png' },
        };
        expect(registry.loadingScreen).toEqual({ image: 'chimera://tactics/ui/loading.png' });
    });

    it('accept the static { image, alt } form', () => {
        const registry: GameScreenRegistry = {
            playfield,
            loadingScreen: { image: 'data:image/gif;base64,R0lGOD', alt: 'Loading' },
        };
        expect(registry.loadingScreen).toEqual({
            image: 'data:image/gif;base64,R0lGOD',
            alt: 'Loading',
        });
    });

    it("accept the 'spinner' preset", () => {
        const registry: GameScreenRegistry = { playfield, loadingScreen: 'spinner' };
        expect(registry.loadingScreen).toBe('spinner');
    });

    it("accept the 'progress' preset", () => {
        const registry: GameScreenRegistry = { playfield, loadingScreen: 'progress' };
        expect(registry.loadingScreen).toBe('progress');
    });

    it("accept the 'none' opt-out sentinel", () => {
        const registry: GameScreenRegistry = { playfield, loadingScreen: 'none' };
        expect(registry.loadingScreen).toBe('none');
    });

    it('reject an arbitrary string sentinel at compile time', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: 'blocking' is not one of 'spinner' | 'progress' | 'none'
            loadingScreen: 'blocking',
        };
        expect(registry.loadingScreen).toBe('blocking');
    });

    it('reject an empty object at compile time', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: neither static form is satisfied, and `{}` is not a component
            loadingScreen: {},
        };
        expect(registry.loadingScreen).toEqual({});
    });

    it('key a per-screen map, carrying every form alongside the fallback slot', () => {
        const registry: GameScreenRegistry = {
            playfield,
            loadingScreen: LoadingCover,
            loadingScreens: {
                playfield: 'spinner',
                summary: 'progress',
                gallery: 'none',
                briefing: { message: 'chimera.loading.assets' },
                credits: { image: '/loading.png', alt: 'Loading' },
                replay: LoadingCover,
                debug: LazyLoadingCover,
            },
        };
        expect(Object.keys(registry.loadingScreens ?? {})).toEqual([
            'playfield',
            'summary',
            'gallery',
            'briefing',
            'credits',
            'replay',
            'debug',
        ]);
    });

    it('name the two static forms so a resolver can annotate its narrowed branches', () => {
        const message: GameLoadingMessage = { message: 'chimera.loading.assets' };
        const image: GameLoadingImage = { image: '/loading.png', alt: 'Loading' };
        const covers: readonly GameLoadingScreen[] = [message, image];
        expect(covers).toEqual([message, image]);
    });
});

// ─── GameScreenRegistry.loadingScreenMinVisibleMs ─────────────────────────────

describe('GameScreenRegistry.loadingScreenMinVisibleMs', () => {
    it('is optional — a registry without it is valid and reads undefined (Invariant #81)', () => {
        const registry: GameScreenRegistry = { playfield };
        expect(registry.loadingScreenMinVisibleMs).toBeUndefined();
    });

    it('accepts a number of milliseconds beside the cover slots it floors', () => {
        const registry: GameScreenRegistry = {
            playfield,
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: 400,
        };
        expect(registry.loadingScreenMinVisibleMs).toBe(400);
    });

    it('rejects a non-number at compile time', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: the minimum is milliseconds as a number, not a duration string
            loadingScreenMinVisibleMs: '400ms',
        };
        expect(registry.loadingScreenMinVisibleMs).toBe('400ms');
    });
});

// ─── GameScreenRegistry.transitionOverlay / TransitionOverlayProps ────────────

describe('GameScreenRegistry.transitionOverlay', () => {
    it('still accepts a component written against GameScreenProps', () => {
        // The killer for dropping `extends GameScreenProps` from
        // `TransitionOverlayProps`: the two prop types then share no assignability
        // in either direction and every existing overlay stops fitting the slot.
        const overlay: GameScreenComponent<GameScreenProps> = () => null;
        const registry: GameScreenRegistry = { playfield, transitionOverlay: overlay };
        expect(registry.transitionOverlay).toBe(overlay);
    });

    it('accepts a component that reads preloadProgress', () => {
        function Overlay(props: TransitionOverlayProps): React.ReactElement | null {
            void props.preloadProgress;
            return null;
        }
        const registry: GameScreenRegistry = { playfield, transitionOverlay: Overlay };
        expect(registry.transitionOverlay).toBe(Overlay);
    });

    // Type legality only — what is legal to WRITE. What a mounted overlay is
    // actually HANDED is measured at the render seam, in
    // `SceneRouter.test.tsx`: "hands a game overlay a fraction and nothing else
    // across a measured run" and its unmeasured twin.
    it('admits a fraction or an absent prop, and rejects null, at compile time', () => {
        // The ABSENT binding is the killer for making `preloadProgress` required;
        // the assignability case above does not move, because a widened prop
        // interface stays assignable to its own base whichever way it is declared.
        const measured: TransitionOverlayProps = { snapshot, sendAction, preloadProgress: 0.25 };
        const absent: TransitionOverlayProps = { snapshot, sendAction };
        const rejected: TransitionOverlayProps = {
            snapshot,
            sendAction,
            // @ts-expect-error: two states, not three. An unmeasured run is
            // reported as an absent prop, so a `null` arm here would be a state
            // no overlay can be handed — and the branch a game wrote for it
            // would never run.
            preloadProgress: null,
        };

        expect(measured.preloadProgress).toBe(0.25);
        expect(absent.preloadProgress).toBeUndefined();
        expect(rejected.preloadProgress).toBeNull();
    });

    it('hands the component it holds a preloadProgress channel', () => {
        // Read the props type OFF THE SLOT, which is the direction the render site
        // uses. Neither case above moves when the slot is reverted to
        // `GameScreenComponent<GameScreenProps>`: an optional added prop leaves the
        // two prop types assignable to each other in both directions, so assigning
        // a component INTO the slot cannot see the widening. This is the killer
        // for that revert.
        type SlotProps =
            NonNullable<GameScreenRegistry['transitionOverlay']> extends GameScreenComponent<
                infer TProps
            >
                ? TProps
                : never;

        const props: SlotProps = { snapshot, sendAction, preloadProgress: 0.75 };

        expect(props.preloadProgress).toBe(0.75);
    });
});
