'use client';

/**
 * renderer/hooks/useQuickStart.ts
 *
 * The game-facing session facade (§4.37.18), published on
 * `@chimera-engine/renderer/game`. One object carrying everything a game's own
 * shell page needs to open, resume and end a lobby-less match, addressed at the
 * game the shell state publishes — so a page never has to read the URL, name a
 * save slot, or know which IPC channel any of it goes through.
 *
 * `start()` with no argument starts the DRAFT, which is the point of the draft:
 * a character-select page writes its picks through `setShellDraft`, and the
 * button that opens the match names nothing. An explicit config merges OVER the
 * draft per key, so a page can override one field without restating the rest.
 *
 * The draft is read TRANSIENTLY (`getShellState()`) rather than subscribed to:
 * a component that only starts a match has no reason to re-render on every
 * keystroke a sibling page makes. `hasAutosave` is the opposite by design — it
 * follows the live slot list, so Continue enables the moment an autosave lands
 * and disables again the moment one is deleted, with no probe on the game's side.
 *
 * Every member REJECTS rather than throwing, including for a missing game
 * context and a missing preload bridge — a `Promise`-returning method that
 * sometimes throws synchronously breaks `void start().catch(report)`, which is
 * how a game will call it. That is deliberately unlike the engine's own menu
 * verbs, where an absent bridge stays a synchronous throw so an engine defect
 * reaches the crash fallback instead of a console line.
 *
 * Invariant #82 discipline holds around the reads, not the verbs: reading shell
 * state opens no channel. The three members ARE the sanctioned session verbs,
 * each routed through a public engine surface rather than an IPC channel opened
 * here.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import { useCallback, useMemo } from 'react';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import type { LeaveGameOptions } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { useLeaveGame } from '../bridge/useLeaveGame';
import { continueFromAutosave as loadAutosave, startQuickMatch } from '../shell/matchEntryVerbs';
import { getShellState, useShellState } from '../shell/shellStateStore';
import { selectHasAutosave, useSaveStore } from '../state/saveStore';

/** The session verbs a game's shell page drives, plus the availability behind Continue. */
export interface QuickStartControls {
    /**
     * Whether the active game has an autosave to resume. Reactive: it follows
     * the slot list `SaveStoreBootstrap` hydrates and subscribes on. `false`
     * with no game in context — there is nothing to continue.
     */
    readonly hasAutosave: boolean;
    /**
     * Open a match without the lobby UI. `config` merges over the shell draft,
     * and the result merges over the game's own `GameLobbySetup.quickStart`
     * defaults in the main process.
     *
     * Rejects when the main process refuses (a session or a restore is already
     * live), when the preload bridge is absent, and when no game is in context.
     * The armed transition is cleared before it rejects.
     */
    start(this: void, config?: QuickStartConfig): Promise<void>;
    /**
     * End the session. Routed through the engine's role-aware leave, so a
     * client disconnects and a host takes the exit its session mode calls for —
     * back to the lobby it came from, or out of a lobby-less quick session
     * atomically, autosave included.
     */
    close(this: void, options?: LeaveGameOptions): Promise<void>;
    /**
     * Resume the active game from its autosave, through the same `saves.load`
     * restore funnel the saves browser uses. Rejects with no game in context.
     */
    continueFromAutosave(this: void): Promise<void>;
}

/** The game id, or a refusal naming the verb that needed one. */
function requireGameId(gameId: string | null, verb: string): string {
    if (gameId === null) {
        throw new Error(
            `[useQuickStart] '${verb}' needs an active game; the shell has no game in context`,
        );
    }
    return gameId;
}

export function useQuickStart(): QuickStartControls {
    const gameId = useShellState((state) => state.gameId);
    // Rebuilt per render, which `useStore` tolerates because the selected value
    // is a boolean and compares equal across renders.
    const hasAutosave = useSaveStore((state) =>
        gameId === null ? false : selectHasAutosave(gameId)(state),
    );
    const leaveGame = useLeaveGame();

    // `async` on purpose: it converts the two synchronous refusals below — no
    // game in context, no preload bridge — into rejections, so this surface has
    // exactly one failure shape.
    const start = useCallback(
        async (config?: QuickStartConfig): Promise<void> => {
            const activeGameId = requireGameId(gameId, 'start');
            // Read at CALL time: the draft a sibling page wrote after this hook
            // last rendered is still the one that opens the match.
            const { draft } = getShellState();
            await startQuickMatch({ ...draft, ...config, gameId: activeGameId });
        },
        [gameId],
    );

    const continueFromAutosave = useCallback(async (): Promise<void> => {
        await loadAutosave(requireGameId(gameId, 'continueFromAutosave'));
    }, [gameId]);

    const close = useCallback(
        (options?: LeaveGameOptions): Promise<void> => leaveGame(options),
        [leaveGame],
    );

    return useMemo(
        () => ({ hasAutosave, start, close, continueFromAutosave }),
        [hasAutosave, start, close, continueFromAutosave],
    );
}
