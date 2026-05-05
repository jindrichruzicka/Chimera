'use client';

// renderer/app/page.tsx
//
// Main-menu shell page. For the M1 boot-smoke (§12 checklist item
// "Electron boots, preload bridge wired") this page only needs to:
//
//   1. Render a visible logo so the developer can see Electron loaded
//      `renderer/out/index.html` via `window.loadFile()`.
//   2. Exercise the preload bridge by calling
//      `window.__chimera.system.platform()` on mount and logging the result
//      so devtools shows the round-trip.
//
// All dispatch/engine logic lives behind `window.__chimera` (invariant 4);
// the renderer never touches Node.js APIs directly.

import React, { useEffect } from 'react';
import { logPlatformOnBoot } from './bootSmoke';

export default function HomePage() {
    useEffect(() => {
        void logPlatformOnBoot(window.__chimera, (message, detail) => {
            if (detail === undefined) {
                console.log(message);
            } else {
                console.log(message, detail);
            }
        });
    }, []);

    return (
        <main
            data-testid="main-menu"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                margin: 0,
            }}
        >
            <img src="./chimera-logo-compact.png" alt="Chimera" width={256} height={256} />
        </main>
    );
}
