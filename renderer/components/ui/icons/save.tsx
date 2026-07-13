import React from 'react';
import type { IconGlyph } from './registry';

// A floppy disk with a notched top-right corner, shutter window, and centre
// spindle, drawn on a 24-unit grid. The path carries no `fill`: the shared
// `.icon { fill: currentColor }` rule colours it from the host's colour token,
// so the glyph tracks a control's variant and its hover/focus states for free
// (Invariant #86: no colour here).
export const saveIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
    ),
};
