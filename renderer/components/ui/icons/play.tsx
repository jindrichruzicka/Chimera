import React from 'react';
import type { IconGlyph } from './registry';

// A solid right-pointing triangle, drawn on a 20-unit grid. The path carries no
// `fill`: the shared `.icon { fill: currentColor }` rule colours it from the
// host's colour token (Invariant #86: no colour here).
export const playIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M6 4l10 6-10 6z" />,
};
