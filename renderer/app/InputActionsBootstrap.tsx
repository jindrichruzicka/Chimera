'use client';

/**
 * renderer/app/InputActionsBootstrap.tsx
 *
 * The app-boot registrar for a game's named input actions (§4.26).
 *
 * Registration happens HERE, at app boot, and off the SHELL payload — the
 * payload a menu route already loads — rather than where a game's actions are
 * first consumed. Registering at the point of use means registering at a lobby
 * or a match, and a shell surface (a live background, a game-owned page) needs
 * the actions before either exists.
 *
 * What it deliberately is NOT:
 *
 *   - a second registry. It writes into the app-lifetime
 *     `InputActionRegistry` that `providers.tsx` seeds with the engine actions.
 *   - a shell-scoped lifetime. There is no unregister: an action registered on
 *     the menu is the same action in the match, which is what makes
 *     `GameShell`'s own re-register a no-op. The cost of that is real and
 *     accepted — two games browsed in one session both keep their entries, so a
 *     `game:*` id they declare with DIFFERENT metadata collides on the menu hop
 *     between them rather than at match entry.
 *
 * Registering is not on its own enough for the action to FIRE — a binding
 * resolves through the settings store's active-game slot, which
 * `SettingsBootstrap` publishes. `renderer/__tests__/shell-input-actions.test.tsx`
 * holds both halves together.
 *
 * The game context comes from `useActiveShellGameId`, whose own header states
 * which routes resolve one and which deliberately do not.
 *
 * Renders nothing. Mounted once, high in `AppShell`.
 */

import { useEffect } from 'react';

import { loadRendererGameShell, type LoadedRendererGameShell } from '../game/rendererGameRegistry';
import type { InputActionRegistry } from '../input/InputActionRegistry.js';
import { useInputActionRegistry } from '../input/InputActionRegistryContext.js';
import { registerInputActions } from '../input/registerInputActions.js';
import { emitRendererError, readRendererLogsApi } from '../logging/rendererLogger';
import { useActiveShellGameId } from '../shell/useActiveShellGameId';

/** Log module name, so a failed shell load is attributable rather than 'global'. */
const LOG_MODULE = 'input-actions-bootstrap';

export function InputActionsBootstrap(): null {
    const gameId = useActiveShellGameId();
    const inputActionRegistry = useInputActionRegistry();

    useEffect(() => {
        if (gameId === null) {
            return;
        }

        let disposed = false;
        void registerShellInputActions(inputActionRegistry, gameId, () => disposed);

        // Cancels the REGISTRATION, not the load — a promise already in flight
        // is not abortable here. What it prevents is a game context the player
        // has already left writing into the registry the next one is claiming.
        return () => {
            disposed = true;
        };
    }, [gameId, inputActionRegistry]);

    return null;
}

/**
 * Load a game's shell payload and register the actions it declares.
 *
 * A failed LOAD is degraded, never fatal: the game is unreachable for reasons
 * that already reach the player elsewhere (a missing registration, a rejected
 * chunk), and an input registry short of one game's actions is a shell that
 * still works. It is logged and swallowed.
 *
 * A divergent RE-REGISTRATION is deliberately NOT caught: the alternative to a
 * rejection is a rebind pane describing one action while the match dispatches
 * another. It leaves this function as a rejected promise, which the caller
 * below does not await — so what the player's log shows for it is the window
 * `unhandledrejection` entry, attributed to 'global' rather than to the module
 * name the load failure carries.
 */
export async function registerShellInputActions(
    inputActionRegistry: InputActionRegistry,
    gameId: string,
    isDisposed: () => boolean,
): Promise<void> {
    let shell: LoadedRendererGameShell;
    try {
        shell = await loadRendererGameShell(gameId);
    } catch (error: unknown) {
        if (!isDisposed()) {
            // Invariant #67: forward with the Error's stack and a named module
            // (not 'global'). emitRendererError alone — console.* is forwarded
            // too, so a console call here would double the entry.
            const logsApi = readRendererLogsApi();
            emitRendererError(
                logsApi,
                `[InputActionsBootstrap] Failed to load the shell payload for '${gameId}'`,
                error instanceof Error ? error : new Error(String(error)),
                undefined,
                LOG_MODULE,
            );
        }
        return;
    }

    if (isDisposed()) {
        return;
    }

    registerInputActions(inputActionRegistry, shell.inputActions);
}
