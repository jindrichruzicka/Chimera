'use client';

// __Game Title__'s playfield — the single required game screen.
// Replace it with your real playfield. As a `GameScreenComponent` it receives
// `GameScreenProps` (the projected `snapshot`, `localPlayerId`, and `sendAction`
// to dispatch game actions); this stub ignores them and just renders.
//
// This stub imports one renderer barrel, `@chimera-engine/renderer/components/ui`.
// The `chimera/no-game-renderer-internals` lint rule is what says which barrels a
// game screen may reach for, so a reach past them is an error rather than a
// review note.
//
// The `sceneHost` wrapper is the screen's root and is deliberately full-bleed —
// see the stylesheet for why `position: absolute` is what makes that work. It is
// where a `<GameCanvas>` goes:
//
//   <div className={styles['sceneHost']}>
//       <GameCanvas camera="top-down">{/* your scene */}</GameCanvas>
//   </div>
//
// with 2D UI layered over it as siblings. Each such sibling must be POSITIONED
// and written AFTER the canvas, both: the engine frame the canvas sits in is a
// positioned element with no z-index, and it can carry an opaque backdrop. The
// panel below is a sibling of no canvas, so it needs neither yet.

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
