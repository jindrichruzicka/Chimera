'use client';

// Boot-smoke page (§12 checklist item "Electron boots, preload bridge wired").
// It only needs to:
//
//   1. Render a visible logo so the developer can see Electron loaded
//      `renderer/out/index.html` via `window.loadFile()`.
//   2. Exercise the preload bridge by calling
//      `window.__chimera.system.platform()` on mount and logging the result
//      so devtools shows the round-trip.
//
// Navigation is handled by the canonical Main Menu at /main-menu.
//
// All dispatch/engine logic lives behind `window.__chimera` (invariant 4);
// the renderer never touches Node.js APIs directly.

import React, { useEffect } from 'react';
import { PreloadedImage } from '../components/ui/PreloadedImage';
import { logPlatformOnBoot } from './bootSmoke';

export default function HomePage() {
    useEffect(() => {
        // §4.27: the healthy round-trip stays on `console.log`, which the
        // renderer logger deliberately does not forward (PII/volume hygiene).
        // A bridge failure routes to `console.warn`, which the renderer logger's
        // patch forwards to the log file — passing the Error as an arg so its
        // stack survives.
        void logPlatformOnBoot(window.__chimera, (level, message, detail) => {
            const sink = level === 'warn' ? console.warn : console.log;
            if (detail === undefined) {
                sink(message);
            } else {
                sink(message, detail);
            }
        });
    }, []);

    return (
        <main
            data-testid="boot-smoke"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                margin: 0,
            }}
        >
            {/* PreloadedImage = priority fetch (exported <head> preload) + a
                decode gate, so the logo appears in a single fully-decoded
                paint instead of tearing in scanline by scanline. */}
            <PreloadedImage
                src="/chimera-logo-compact.png"
                alt="Chimera"
                width={256}
                height={256}
            />
        </main>
    );
}
