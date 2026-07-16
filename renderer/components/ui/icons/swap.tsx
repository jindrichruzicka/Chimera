import React from 'react';
import type { IconGlyph } from './registry';

// Two opposed solid arrows on a 20-unit grid — "swap perspective". The path
// carries no `fill`: the shared `.icon { fill: currentColor }` rule colours it
// from the host's colour token (Invariant #86: no colour here).
export const swapIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M3 5h9V2.5l5 4-5 4V8H3V5Zm14 10h-9v2.5l-5-4 5-4V12h9v3Z" />,
};
