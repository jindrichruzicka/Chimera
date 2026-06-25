'use client';

// renderer/components/shell/InGameMenuHost.tsx

import React, { useCallback, useState } from 'react';
import type { PlayerId } from '@chimera/simulation/bridge/api-types.js';
import type {
    GameScreenComponent,
    InGameMenuProps,
} from '@chimera/simulation/foundation/game-screen-contract.js';
import { useLeaveGame } from '../../bridge/useLeaveGame.js';
import { useInputAction } from '../../input/useInputAction.js';
import { Button } from '../ui/Button.js';
import { Modal } from '../ui/Modal.js';
import { useEscapeLayer } from './EscapeStack.js';

export interface InGameMenuHostProps {
    /**
     * The game's `inGameMenu` registry slot (F55). A component overrides the
     * engine default; the string `'none'` opts out (Escape is a no-op); omitted
     * (`undefined`) yields the engine-default Resume/Leave menu.
     */
    readonly inGameMenu?: GameScreenComponent<InGameMenuProps> | 'none';
    /** Whether the local player hosted the match — drives host vs client copy. */
    readonly isHost?: boolean;
    /** The local player's id, or `undefined` for a purely local game with no lobby. */
    readonly localPlayerId?: PlayerId;
}

/**
 * Mounts the Escape-toggled in-game menu for an in-progress match (F55 ·
 * §4.33–§4.34). Mounted by `RegistryGameShell`, which keeps `GameShell`
 * game-agnostic (Invariant #80): the menu reaches the shell only through the
 * registry-supplied `inGameMenu` slot.
 *
 * Open state is renderer-local. The host subscribes to the `engine:toggle-menu`
 * action (bound to Escape by default, but rebindable — keyed to the action, not
 * a hardcoded key) and registers as the *base layer* of the shared Escape stack
 * while open, so an open transient overlay consumes Escape before the menu and a
 * second Escape closes the menu rather than re-toggling it.
 */
export function InGameMenuHost({
    inGameMenu,
    isHost = false,
    localPlayerId,
}: InGameMenuHostProps): React.ReactElement | null {
    const [open, setOpen] = useState(false);
    const leaveGame = useLeaveGame();

    // `'none'` is a full opt-out: the toggle is inert and nothing ever renders.
    const enabled = inGameMenu !== 'none';

    const closeMenu = useCallback(() => {
        setOpen(false);
    }, []);

    // Keyed to the action so rebinds are honoured. When the menu is closed the
    // empty Escape stack lets Escape fall through to the InputManager and toggle
    // here; when open, the base layer below closes it (InputManager suppressed),
    // so there is no double-toggle.
    //
    // Act only on the key-down (`pressed`): `engine:toggle-menu` is oneShot, but
    // the InputManager still dispatches the key-up — without this guard a single
    // Escape tap would toggle open then immediately closed. Mirrors the
    // `engine:toggle-perf-hud` handler in PerfHud.
    useInputAction('engine:toggle-menu', (event) => {
        if (!event.pressed) return;
        if (!enabled) return;
        setOpen((current) => !current);
    });

    // Base layer of the Escape stack while open (T6): closes the menu, and a
    // transient overlay registered above it wins the Escape.
    useEscapeLayer(closeMenu, open && enabled);

    const handleLeave = useCallback(() => {
        void leaveGame();
    }, [leaveGame]);

    if (!enabled || !open) {
        return null;
    }

    const Menu = inGameMenu ?? DefaultInGameMenu;

    // Invariant #88: overlay/menu components render under a Suspense boundary.
    return (
        <React.Suspense fallback={null}>
            <Menu
                closeMenu={closeMenu}
                leaveGame={handleLeave}
                isHost={isHost}
                {...(localPlayerId === undefined ? {} : { localPlayerId })}
            />
        </React.Suspense>
    );
}

/**
 * Engine-default in-game menu rendered when a game omits the `inGameMenu` slot.
 * Resume returns to the match; Leave routes through `useLeaveGame` (role-aware)
 * behind a confirmation step. Built on the design-system `Modal` (focus-trap,
 * `aria-modal`, backdrop) and `Button`, using `var(--ch-*)` tokens only.
 */
function DefaultInGameMenu({ closeMenu, leaveGame, isHost }: InGameMenuProps): React.ReactElement {
    const [confirming, setConfirming] = useState(false);

    const leavePrompt = isHost
        ? 'Leave the match? This ends it for everyone and returns all players to the lobby.'
        : 'Leave the match? You will disconnect and return to the main menu.';

    return (
        <Modal open title="Menu" onClose={closeMenu}>
            <div style={menuBodyStyle}>
                {confirming ? (
                    <>
                        <p style={leavePromptStyle}>{leavePrompt}</p>
                        <div style={confirmActionsStyle}>
                            <Button variant="secondary" onClick={() => setConfirming(false)}>
                                Cancel
                            </Button>
                            <Button variant="danger" onClick={leaveGame}>
                                Confirm leave
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <Button variant="primary" onClick={closeMenu}>
                            Resume
                        </Button>
                        <Button variant="danger" onClick={() => setConfirming(true)}>
                            Leave match
                        </Button>
                    </>
                )}
            </div>
        </Modal>
    );
}

const menuBodyStyle: React.CSSProperties = {
    display: 'grid',
    gap: 'var(--ch-space-sm)',
};

const leavePromptStyle: React.CSSProperties = {
    margin: 'var(--ch-space-none)',
};

const confirmActionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--ch-space-sm)',
    justifyContent: 'flex-end',
};
