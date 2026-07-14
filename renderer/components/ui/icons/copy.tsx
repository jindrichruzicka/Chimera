import React from 'react';
import type { IconGlyph } from './registry';

// Two offset sheets — a back sheet outline behind a hollow front frame (the
// evenodd rule punches out the frame's window) — drawn on a 20-unit grid. The
// paths carry no `fill`: the shared `.icon { fill: currentColor }` rule colours
// them from the host's colour token (Invariant #86: no colour here).
export const copyIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: (
        <>
            <path d="M7 3h9v11h-2V5H7z" />
            <path fillRule="evenodd" d="M4 6h9v11H4Zm2 2v7h5V8Z" />
        </>
    ),
};
