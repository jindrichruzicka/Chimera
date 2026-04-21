'use client';

// renderer/app/page.tsx
//
// Main-menu shell page. For the M1 boot-smoke (§12 checklist item
// "Electron boots, preload bridge wired") this page only needs to:
//
//   1. Render a visible heading so the developer can see Electron loaded
//      `renderer/out/index.html` via `window.loadFile()`.
//   2. Exercise the preload bridge by calling
//      `window.__chimera.system.platform()` on mount and logging the result
//      so devtools shows the round-trip.
//
// All dispatch/engine logic lives behind `window.__chimera` (invariant 4);
// the renderer never touches Node.js APIs directly.

import { useEffect } from 'react';
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
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
            <h1>Chimera</h1>
            <p>Engine shell — M1 boot smoke. See devtools console for bridge status.</p>
        </main>
    );
}
