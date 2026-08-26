'use client';

/**
 * renderer/shell/matchEntryVerbs.ts
 *
 * The two engine-implemented match ENTRIES — quick start and continue — and the
 * shell transition protocol around them (§4.37.18).
 *
 * One definition, two callers: the declarative main-menu verbs
 * (`RenderMainMenuDefinition`'s `start-game` / `continue`) and the game-facing
 * `useQuickStart()` facade. They differ only in where the game id comes from —
 * a menu declaration addresses the game the menu was rendered for, a page
 * addresses the one the shell state publishes — so the arm/clear protocol lives
 * here rather than being re-applied at each site.
 *
 * The protocol is: ARM before the IPC call, so a background timing a dolly-in
 * on `transition.durationMs` has the whole screen fade to move; leave it armed
 * on success, where the store clears it the moment the match surface lands; and
 * CLEAR on rejection, because a refused entry must not leave a background
 * dollied into a match that never came, nor make the next unrelated route
 * change read as a match entry.
 *
 * Neither verb navigates. The hop into `/game` belongs to `GameStoreBootstrap`'s
 * snapshot gate — see §4.37.17, The entry allow-set, for which surfaces it
 * admits.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import type {
    LobbyAPI,
    QuickStartParams,
    SlotId,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import { getSavesBridge } from '../hooks/useSavesApi';
import { screenFadeMs } from '../components/shell/screenFadeDuration.js';
import { armShellTransition, clearShellTransition } from './shellStateStore';

/**
 * Narrow resolver for the quick-start slice of the preload lobby bridge.
 * Deliberately not `getLobbyBridge()` from the lobby page's hook: that helper
 * also demands `__chimera.system`, an unrelated dependency this call never
 * touches (the same reason `useLeaveGame` resolves its own).
 */
function resolveQuickStartApi(): Pick<LobbyAPI, 'quickStart'> | null {
    const bridge = globalThis as { readonly __chimera?: { readonly lobby?: LobbyAPI } };
    const lobby = bridge.__chimera?.lobby;
    return lobby === undefined || typeof lobby.quickStart !== 'function' ? null : lobby;
}

/**
 * Runs one match entry under the arm/clear protocol. Both failure shapes clear,
 * and both keep the shape they had before this wrapper existed: an absent
 * preload bridge throws SYNCHRONOUSLY into the caller (an engine defect that
 * belongs in the crash fallback), while a refused IPC arrives as a rejected
 * promise (a runtime condition the caller reports).
 *
 * Deliberately not `async`: an `async` function turns a synchronous throw into
 * a rejection, which would quietly move the bridge-missing case from the error
 * boundary into a console line.
 */
function underArmedTransition(enter: () => Promise<unknown>): Promise<void> {
    armShellTransition({ kind: 'to-match', durationMs: screenFadeMs() });
    let entered: Promise<unknown>;
    try {
        entered = enter();
    } catch (error) {
        clearShellTransition();
        throw error;
    }
    return entered.then(
        () => undefined,
        (error: unknown) => {
            clearShellTransition();
            throw error;
        },
    );
}

/**
 * Open a match without the lobby UI. `params` is merged OVER the game's own
 * `GameLobbySetup.quickStart` defaults by the main process, so a caller that
 * supplies only `gameId` starts exactly the match the game declared.
 *
 * Rejects with whatever main refused with — the caller decides how to report
 * it. The transition is already cleared by then.
 */
export function startQuickMatch(params: QuickStartParams): Promise<void> {
    return underArmedTransition(() => {
        const lobby = resolveQuickStartApi();
        if (lobby === null) {
            throw new Error('Chimera lobby API not available');
        }
        return lobby.quickStart(params);
    });
}

/**
 * Resume `gameId` from its autosave. The engine picks the slot; the call behind
 * it is the same `saves.load` the saves browser issues, so the whole restore
 * funnel — including the waiting overlay a multiplayer autosave needs — is
 * reused rather than rebuilt.
 */
export function continueFromAutosave(gameId: string): Promise<void> {
    return underArmedTransition(() => {
        const saves = getSavesBridge();
        if (saves === null) {
            throw new Error('Chimera saves API not available');
        }
        return saves.load(autosaveSlotId(gameId) as SlotId);
    });
}
