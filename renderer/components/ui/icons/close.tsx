import React from 'react';
import type { IconGlyph } from './registry';

// A diagonal cross, drawn on a 20-unit grid. The path carries no `fill`: the
// shared `.icon { fill: currentColor }` rule colours it from the host's colour
// token (Invariant #86: no colour here).
export const closeIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: (
        <path d="M5.3 4 4 5.3 8.7 10 4 14.7 5.3 16 10 11.3 14.7 16 16 14.7 11.3 10 16 5.3 14.7 4 10 8.7z" />
    ),
};
