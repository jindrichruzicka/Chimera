'use client';

// __Game Title__'s playfield — the single required game screen (Invariant #81).
// Replace it with your real playfield. As a `GameScreenComponent` it receives
// `GameScreenProps` (the projected `snapshot`, `localPlayerId`, and `sendAction`
// to dispatch game actions); this stub ignores them and just renders.
//
// This stub imports one renderer barrel, `@chimera-engine/renderer/components/ui`.
// Invariant #96 is what says which barrels a game screen may reach for; the
// `chimera/no-game-renderer-internals` lint rule enforces it, so a reach past
// them is an error rather than a review note.
//
// The `sceneHost` wrapper is the screen's root and is deliberately full-bleed —
// see the stylesheet for why `position: absolute` is what makes that work. It is
// where a `<GameCanvas>` goes:
//
//   <div className={styles['sceneHost']}>
//       <GameCanvas camera="top-down">{/* your scene */}</GameCanvas>
//   </div>
//
// with 2D UI layered over it as siblings, exactly as the panel is here.

import React from 'react';
import { Caption, Panel } from '@chimera-engine/renderer/components/ui';

import styles from './__GamePascal__Playfield.module.css';

export default function __GamePascal__Playfield(): React.ReactElement {
    return (
        <div className={styles['sceneHost']}>
            <Panel title="__Game Title__" className={styles['playfield']}>
                <Caption>
                    Your new Chimera game is running. Edit screens/ to build your playfield, and
                    dispatch actions through the `sendAction` prop.
                </Caption>
            </Panel>
        </div>
    );
}
