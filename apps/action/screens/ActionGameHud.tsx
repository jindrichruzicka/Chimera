'use client';

// The action app's HUD: the heartbeat count and a save affordance.
//
// Minimal on purpose. A realtime sandbox has no turn to end, no undo history a
// player reasons about, and no result to announce — so the engine's `handleUndo`
// / `handleRedo` / `handleEndTurn` capabilities are deliberately left unwired
// rather than rendered as controls that would do nothing meaningful mid-beat.
//
// What IS here is the pair that says the app is alive and keepable:
//
//   - the TICK, which advances on the host's wall-clock heartbeat. It is the
//     one visible proof that the realtime lifecycle is running: in a turn-based
//     game the number only moves when somebody acts.
//   - SAVE. `saveGame` is optional on the props, and its ABSENCE is the
//     engine's withholding mechanism (non-host, no handler wired, or controls
//     locked after the match resolves), so the button is rendered only when the
//     capability actually arrived.
//
// Module boundary: the renderer is reached only through `components/ui`
// (Invariant #96).

import React from 'react';
import { SaveGameButton } from '@chimera-engine/renderer/components/ui';
import type { GameHudProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

import styles from './ActionGameHud.module.css';

export function ActionGameHud({ tick, saveGame }: GameHudProps): React.ReactElement {
    return (
        <div className={styles['hud']}>
            <span className={styles['tick']} data-testid="action-hud-tick">
                {`Tick ${String(tick)}`}
            </span>
            <div className={styles['controls']}>
                {saveGame !== undefined && (
                    <SaveGameButton
                        data-testid="action-hud-save-btn"
                        onSave={saveGame}
                        trigger="icon"
                    />
                )}
            </div>
        </div>
    );
}

export default ActionGameHud;
