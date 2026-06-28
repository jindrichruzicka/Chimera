'use client';

// __Game Title__'s board — the single required game screen (Invariant #81).
// Replace it with your real board. As a `GameScreenComponent` it receives
// `GameScreenProps` (the projected `snapshot`, `localPlayerId`, and `sendAction`
// to dispatch game actions); this stub ignores them and just renders. Game
// screens may import the renderer only through its public component barrels —
// `@chimera-engine/renderer/components/ui` and `@chimera-engine/renderer/components/chat`
// (Invariant #96).

import React from 'react';
import { Caption, Heading, Panel } from '@chimera-engine/renderer/components/ui';

export default function __GamePascal__Board(): React.ReactElement {
    return (
        <Panel title="__Game Title__">
            <Heading>__Game Title__</Heading>
            <Caption>
                Your new Chimera game is running. Edit screens/ to build your board, and dispatch
                actions through the `sendAction` prop.
            </Caption>
        </Panel>
    );
}
