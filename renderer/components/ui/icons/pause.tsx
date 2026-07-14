import React from 'react';
import type { IconGlyph } from './registry';

// Two solid pause bars, drawn on a 20-unit grid. The path carries no `fill`:
// the shared `.icon { fill: currentColor }` rule colours it from the host's
// colour token (Invariant #86: no colour here).
export const pauseIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z" />,
};
