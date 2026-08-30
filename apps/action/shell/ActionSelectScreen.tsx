'use client';

// The action app's `/select` page — the pre-match picker, and the surface that
// makes the F87 draft load-bearing (§4.37.17, §4.37.18).
//
// It is a GAME-OWNED shell route: a physical page in the app's own Next tree
// (`renderer/app/select/page.tsx`) that the shell payload declares through
// `shellRoutes`. That declaration is what classifies it as the `page` surface,
// which keeps the SAME live background instance alive across
// `/main-menu → /select → /settings` and lets the snapshot gate carry the
// player into the match once one starts.
//
// The page and the background share the picks through ONE thing: the draft.
// There is no module-local store beside it, no context, no prop — the page
// writes with `setShellDraft` and the background reads with `useShellState`,
// which is the whole point of the field existing (Invariant #139).
//
// PRE-MATCH INPUT. The two selection rings move on the SAME rebindable actions
// the match moves the primitives with — registered at app boot off the shell
// payload (§4.26), so they work here, before any match has run, and a rebind
// made in Settings reaches this page. Arrows move player one's ring; WASD moves
// player two's, which is also the cluster that seat plays with, so the picker
// teaches the controls.
//
// The container is CLICK-THROUGH so the background underneath stays clickable —
// see the module CSS for why that is the page's own job and not the engine's.
//
// Module boundary: the renderer is reached only through its public barrels
// (Invariant #96) — here `components/ui`, `game`, `i18n` and `input`.

import React from 'react';
import { Button, Caption, Heading, Panel, Toggle } from '@chimera-engine/renderer/components/ui';
import {
    getShellState,
    setShellDraft,
    useQuickStart,
    useShellNavigate,
    useShellState,
} from '@chimera-engine/renderer/game';
import { useTranslate } from '@chimera-engine/renderer/i18n';
import { useInputAction } from '@chimera-engine/renderer/input';

import {
    ACTION_MOVE_DIRECTIONS,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_P2_MOVE_LEFT_ACTION,
    ACTION_P2_MOVE_RIGHT_ACTION,
    type ActionMoveActionId,
} from '../input-action-ids.js';
import {
    ensureActionHostPick,
    readActionShellPicks,
    setActionSecondPlayer,
    stepActionPick,
    type ActionShellSeat,
} from './actionShellSelection.js';
import { SELECT_KEYS } from './translations/keys.js';
import styles from './ActionSelectScreen.module.css';

/** The route the Back control returns to. */
const MAIN_MENU_ROUTE = '/main-menu';

export function ActionSelectScreen(): React.ReactElement {
    const t = useTranslate();
    const navigate = useShellNavigate();
    const { start } = useQuickStart();

    const draft = useShellState((state) => state.draft);
    const picks = readActionShellPicks(draft);
    const secondPlayer = picks.second !== null;

    const [startFailed, setStartFailed] = React.useState(false);

    // Land the default pick IN the draft, so what the player sees ringed is what
    // the match receives. Reads transiently and writes only when there is
    // nothing there: re-writing the default on every mount would throw away the
    // pick made before a trip through Settings and back.
    React.useEffect(() => {
        const patch = ensureActionHostPick(getShellState().draft);
        if (patch !== null) {
            setShellDraft(patch);
        }
    }, []);

    useActionPickKeys('host', ACTION_MOVE_LEFT_ACTION, ACTION_MOVE_RIGHT_ACTION);
    useActionPickKeys('second', ACTION_P2_MOVE_LEFT_ACTION, ACTION_P2_MOVE_RIGHT_ACTION);

    const handleSecondPlayer = (enabled: boolean): void => {
        const patch = setActionSecondPlayer(getShellState().draft, enabled);
        if (patch !== null) {
            setShellDraft(patch);
        }
    };

    const handleStart = (): void => {
        setStartFailed(false);
        // No argument: `start()` opens the DRAFT, which is exactly what this page
        // has been writing. Naming a config here would restate the picks and let
        // the two disagree.
        //
        // The rejection is caught rather than left to the window: every failure
        // shape this surface can produce — a session already live, main refusing,
        // no bridge — leaves the player on this page, so the page has to say so.
        void start().catch(() => {
            setStartFailed(true);
        });
    };

    return (
        <div className={styles['container']} data-testid="action-select-page">
            <div className={styles['header']}>
                <Heading level={1}>{t(SELECT_KEYS.title)}</Heading>
                <Caption>{t(SELECT_KEYS.hint)}</Caption>
            </div>

            <Panel className={styles['footer']}>
                <div className={styles['picks']}>
                    <Caption data-testid="action-select-host-pick">
                        {t(SELECT_KEYS.hostPick, { shape: picks.host })}
                    </Caption>
                    {picks.second !== null && (
                        <Caption data-testid="action-select-second-pick">
                            {t(SELECT_KEYS.secondPick, { shape: picks.second })}
                        </Caption>
                    )}
                </div>

                <Toggle
                    checked={secondPlayer}
                    data-testid="action-select-second-player"
                    label={t(SELECT_KEYS.secondPlayer)}
                    helperText={t(SELECT_KEYS.secondPlayerHint)}
                    onCheckedChange={handleSecondPlayer}
                />

                <div className={styles['actions']}>
                    <Button
                        variant="secondary"
                        data-testid="action-select-back"
                        onClick={() => {
                            navigate(MAIN_MENU_ROUTE);
                        }}
                    >
                        {t(SELECT_KEYS.back)}
                    </Button>
                    <Button
                        variant="primary"
                        data-testid="action-select-start"
                        onClick={handleStart}
                    >
                        {t(SELECT_KEYS.start)}
                    </Button>
                </div>

                {startFailed && (
                    <Caption tone="error" data-testid="action-select-start-failed">
                        {t(SELECT_KEYS.startFailed)}
                    </Caption>
                )}
            </Panel>
        </div>
    );
}

/**
 * Move one seat's ring with its own left/right movement actions.
 *
 * The horizontal pair only: the three primitives sit in one row, so the
 * vertical keys carry a `dx` of 0 and `stepActionPick` answers them as the
 * no-op they are. Subscribing them anyway would claim a meaning the row does
 * not have.
 *
 * The draft is read TRANSIENTLY at keypress time rather than closed over, for
 * the reason the background's click handler is: the OTHER seat may have moved
 * since this render, and a captured draft would let one seat step onto a shape
 * the other had just taken.
 */
function useActionPickKeys(
    seat: ActionShellSeat,
    left: ActionMoveActionId,
    right: ActionMoveActionId,
): void {
    const step = (id: ActionMoveActionId, pressed: boolean): void => {
        // Press only. A key-up carries the same id, and stepping on both edges
        // would move the ring twice per tap.
        if (!pressed) {
            return;
        }
        const patch = stepActionPick(getShellState().draft, seat, ACTION_MOVE_DIRECTIONS[id].dx);
        if (patch !== null) {
            setShellDraft(patch);
        }
    };

    useInputAction(left, (event) => {
        step(left, event.pressed);
    });
    useInputAction(right, (event) => {
        step(right, event.pressed);
    });
}
