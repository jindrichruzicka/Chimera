import React from 'react';
import type { IconGlyph } from './registry';

// A stop bar with a left-pointing triangle, drawn on a 20-unit grid. The path
// carries no `fill`: the shared `.icon { fill: currentColor }` rule colours it
// from the host's colour token (Invariant #86: no colour here).
export const seekStartIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M4 4h2v12H4zm12 0-8 6 8 6z" />,
};
