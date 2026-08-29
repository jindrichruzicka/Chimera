/**
 * renderer/game/index.ts
 *
 * Public game barrel (`@chimera-engine/renderer/game`) — one of the eight
 * Invariant #96 surfaces, and the only one a game's renderer COMPOSITION ROOT
 * needs.
 *
 * Two halves:
 *
 *   1. The registration seam (`registerRendererGame` and the payload types)
 *      a consumer app's renderer composition root calls. This is a CURATED
 *      re-export of `rendererGameRegistry.ts`, not the module itself, which is
 *      what keeps `_resetRendererGameRegistryForTest` internal — a name
 *      prefixed `_` is not published API.
 *   2. The PAGE SERVICES (§4.37.18): what a game's own shell page, background
 *      and character picker need from the shell around them. `useShellState`
 *      for a React read, `getShellState` for a transient `useFrame` read that
 *      re-renders nothing, `setShellDraft` for the ONE field a game writes, and
 *      the two verbs — `useShellNavigate` for a context-preserving hop and
 *      `useQuickStart` for opening, resuming and ending a lobby-less match.
 *
 * What is deliberately NOT here: a setter for `surface`, `pathname`, `gameId`
 * or `transition`. Those are written by enumerated engine sites only
 * (`ShellStateBridge` and the match-entry flows), so a game can react to a
 * route change and never author one; `renderer/game/__tests__/game-barrel-side-effects.test.ts`
 * pins the absence as a closed set rather than as a convention.
 *
 * Re-export only, but NOT import-inert: the page services reach the renderer
 * state stores, whose module-level singletons are eager, so importing this
 * barrel constructs them. The exact set is pinned beside the symbol list.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

export {
    GAME_SHELL_WARMUP_BUDGET_MS,
    UnknownRendererGameError,
    getRendererGameMenuCommand,
    loadRendererGame,
    loadRendererGameShell,
    registerRendererGame,
    type GameShellMusicBed,
    type GameTranslations,
    type LoadedRendererGame,
    type LoadedRendererGameShell,
    type RendererGameContribution,
    type RendererGameLoader,
    type RendererGameShellLoader,
} from './rendererGameRegistry.js';

export {
    getShellState,
    setShellDraft,
    useShellState,
    type ShellState,
    type ShellSurface,
    type ShellTransition,
    type ShellTransitionKind,
} from '../shell/shellStateStore.js';

export { useShellNavigate, type ShellNavigate } from '../shell/useShellNavigate.js';

export { useQuickStart, type QuickStartControls } from '../hooks/useQuickStart.js';
