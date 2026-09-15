'use client';

// __Game Title__'s playfield — the single required game screen.
// Replace it with your real playfield. As a `GameScreenComponent` it receives
// `GameScreenProps` (the projected `snapshot`, `localPlayerId`, and `sendAction`
// to dispatch game actions); this stub ignores them and just renders.
//
// This stub imports two renderer barrels, `@chimera-engine/renderer/components/r3f`
// for the 3D scene and `@chimera-engine/renderer/components/ui` for the panel.
// The `chimera/no-game-renderer-internals` lint rule is what says which barrels a
// game screen may reach for, so a reach past them is an error rather than a
// review note.
//
// The `sceneHost` wrapper is the screen's root and is deliberately full-bleed —
// see the stylesheet for why `position: absolute` is what makes that work. The
// scene fills it, and 2D UI is layered over the scene as siblings. Each such
// sibling must be POSITIONED and written AFTER the canvas, both: the engine frame
// the canvas sits in is a positioned element with no z-index, and it can carry an
// opaque backdrop. The panel below is both.
//
// `<LightingRig />` is the engine's default light rig: an ambient fill and a
// directional key light. A scene with no light renders a lit material such as
// `meshStandardMaterial` black, so keep the rig, configure it through its props,
// or add lights of your own beside it. It must stay a child of `<GameCanvas>`.

import React from 'react';
import { GameCanvas, LightingRig } from '@chimera-engine/renderer/components/r3f';
import { Caption, Panel } from '@chimera-engine/renderer/components/ui';

import styles from './__GamePascal__Playfield.module.css';

export default function __GamePascal__Playfield(): React.ReactElement {
    return (
        <div className={styles['sceneHost']}>
            <div className={styles['sceneCanvas']}>
                <GameCanvas camera="top-down">
                    <LightingRig />
                    {/* Your scene: meshes, models and sprites go here. */}
                </GameCanvas>
            </div>
            <Panel title="__Game Title__" className={styles['playfield']}>
                <Caption>
                    Your new Chimera game is running. Edit screens/ to build your playfield, and
                    dispatch actions through the `sendAction` prop.
                </Caption>
            </Panel>
        </div>
    );
}
