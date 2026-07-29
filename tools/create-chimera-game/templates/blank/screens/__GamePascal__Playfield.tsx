'use client';

// __Game Title__'s playfield — the single required game screen (Invariant #81).
// Replace it with your real playfield. As a `GameScreenComponent` it receives
// `GameScreenProps` (the projected `snapshot`, `localPlayerId`, and `sendAction`
// to dispatch game actions); this stub ignores them and just renders. Game
// screens may import the renderer only through its public component barrels —
// `@chimera-engine/renderer/components/ui`, `@chimera-engine/renderer/components/chat`,
// and `@chimera-engine/renderer/components/r3f` (Invariant #96).

import React from 'react';
import { Caption, Panel } from '@chimera-engine/renderer/components/ui';

import styles from './__GamePascal__Playfield.module.css';

export default function __GamePascal__Playfield(): React.ReactElement {
    return (
        <Panel title="__Game Title__" className={styles['playfield']}>
            <Caption>
                Your new Chimera game is running. Edit screens/ to build your playfield, and
                dispatch actions through the `sendAction` prop.
            </Caption>
        </Panel>
    );
}
