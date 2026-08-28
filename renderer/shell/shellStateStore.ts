/**
 * renderer/shell/shellStateStore.ts
 *
 * The shell-state store (§4.37.18): ONE module singleton carrying everything a
 * game's own shell surfaces — a custom page, a live background, a character
 * picker — need to know about the shell around them, and the one field they may
 * write back.
 *
 * The state is plain data, so `getShellState()` is a transient read a `useFrame`
 * callback can make every frame without subscribing, and `useShellState`
 * (selector) is the React half. The WRITERS are module functions rather than
 * store methods for the same reason: state a selector reads should hold nothing
 * that is neither renderable nor comparable.
 *
 * Who may write what:
 *
 *   - `setShellRoute` — `ShellStateBridge` only. It is the single
 *     route-classification site (§4.37.18), and `renderer/shell/__tests__/
 *     route-classification-census.test.ts` is what holds that.
 *   - `armShellTransition` / `clearShellTransition` — the enumerated match-entry
 *     flows: the snapshot navigation gate's fade effect and the quick-start /
 *     continue handlers.
 *   - `setShellDraft` — the ONE game-reachable writer, published on
 *     `@chimera-engine/renderer/game`. A game page and a live background reading
 *     the same picks is the whole reason it exists; the route fields carry no
 *     game-reachable setter at all.
 *
 * Discipline (mirrors Invariant #82): reading or reacting to shell state never
 * triggers IPC, advances a tick, or dispatches an `EngineAction`. Nothing in
 * this module imports a bridge.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import type { ShellSurface } from './shellRoutes';

export type { ShellSurface };

/**
 * Which way a match entry is going, so a background can dolly IN on the way to
 * a match and back OUT on the way to the shell rather than guessing from the
 * surface it is about to leave.
 */
export type ShellTransitionKind = 'to-match' | 'to-shell';

/**
 * An armed screen transition. `durationMs` is the app-level screen fade the
 * engine is running for this hop (`screenFadeMs()`), carried so a background
 * times its own move to the same clock instead of hardcoding one.
 */
export interface ShellTransition {
    readonly kind: ShellTransitionKind;
    readonly durationMs: number;
}

/** The classified route `ShellStateBridge` publishes. */
export interface ShellRoute {
    readonly surface: ShellSurface;
    /** The route path, already normalized (no trailing slash, no `/index.html`). */
    readonly pathname: string;
    /** The `?gameId=` context, or `null` on a route that declares none. */
    readonly gameId: string | null;
}

/** Everything the shell publishes about itself. Plain data, all of it. */
export interface ShellState extends ShellRoute {
    /** The armed match-entry transition, or `null` when none is in flight. */
    readonly transition: ShellTransition | null;
    /**
     * The cross-page quick-start draft: the one field a game writes. It is
     * deliberately a `QuickStartConfig` and not a free-form bag, so what a
     * character-select page accumulates is exactly what `useQuickStart().start`
     * can hand to `chimera:lobby:quick-start`.
     */
    readonly draft: QuickStartConfig;
}

const INITIAL_STATE: ShellState = Object.freeze({
    surface: 'boot',
    pathname: '/',
    gameId: null,
    transition: null,
    draft: Object.freeze({}),
} satisfies ShellState);

/** Create an isolated store instance. The singleton below is the live one. */
export function createShellStateStore(): StoreApi<ShellState> {
    return createStore<ShellState>()(() => INITIAL_STATE);
}

export const shellStateStore: StoreApi<ShellState> = createShellStateStore();

/**
 * Zustand hook for the shell state. Always subscribe through a narrow selector —
 * a component that selects the whole state re-renders on every route change AND
 * on every draft write.
 */
export function useShellState<TSelected>(selector: (state: ShellState) => TSelected): TSelected {
    return useStore(shellStateStore, selector);
}

/**
 * Transient read: the state right now, with no subscription and therefore no
 * re-render. This is the form a `useFrame` callback takes — reading through
 * {@link useShellState} there would re-render the subscriber on every write it
 * observes, at frame rate.
 */
export function getShellState(): ShellState {
    return shellStateStore.getState();
}

/**
 * Whether an armed transition has arrived. A `to-match` transition is over once
 * the match surface is on screen; a `to-shell` one is over once any other
 * surface is. Clearing on arrival is what keeps a background from staying
 * dollied into a match it already entered, and what keeps the NEXT unrelated
 * route change from reading as a match entry.
 *
 * Only ever asked on a route CHANGE (see below), so a transition armed at the
 * surface it is already "arrived" at — `to-shell` raised from the replay
 * player, whose route is not the match — survives the hop it was armed for
 * rather than being cleared by the next republish of the route it started on.
 */
function transitionArrived(transition: ShellTransition, surface: ShellSurface): boolean {
    return transition.kind === 'to-match' ? surface === 'match' : surface !== 'match';
}

/**
 * Publish the classified route. Called by `ShellStateBridge` on every commit,
 * so an unchanged route must publish NOTHING: the store would otherwise notify
 * every subscriber per render, and re-render each one holding a selector the
 * new state object compares unequal on.
 */
export function setShellRoute(route: ShellRoute): void {
    shellStateStore.setState((state) => {
        const routeUnchanged =
            state.surface === route.surface &&
            state.pathname === route.pathname &&
            state.gameId === route.gameId;
        if (routeUnchanged) {
            return state;
        }
        const transition =
            state.transition !== null && transitionArrived(state.transition, route.surface)
                ? null
                : state.transition;
        return { ...state, ...route, transition };
    });
}

/**
 * Arm a match-entry transition. Called by the enumerated engine flows the
 * moment the entry BEGINS — not when it lands — so a background has the whole
 * fade to move in.
 */
export function armShellTransition(transition: ShellTransition): void {
    shellStateStore.setState((state) => ({ ...state, transition }));
}

/**
 * Disarm. The load-bearing caller is the IPC REJECTION path of every armed
 * flow: a quick start main refuses must not leave a background dollied into a
 * match that never came. Clearing with nothing armed publishes nothing.
 */
export function clearShellTransition(): void {
    shellStateStore.setState((state) =>
        state.transition === null ? state : { ...state, transition: null },
    );
}

/**
 * The one game-reachable writer. Merges per key — a page that names only
 * `hostAttributes` leaves a sibling page's `gameParams` alone — and publishes
 * a NEW draft object so a selector on it compares unequal and re-renders.
 *
 * A key the patch names is REPLACED, never deep-merged: seat lists replace
 * wholesale, because a list's length is its seat count and a positional merge
 * would silently invent seats.
 */
export function setShellDraft(patch: QuickStartConfig): void {
    shellStateStore.setState((state) => ({ ...state, draft: { ...state.draft, ...patch } }));
}

/**
 * Test-only: return the singleton to its initial state so each test starts from
 * the boot surface. Never called by production code, and not exported from the
 * game barrel.
 */
export function _resetShellStateForTest(): void {
    shellStateStore.setState(INITIAL_STATE, true);
}
