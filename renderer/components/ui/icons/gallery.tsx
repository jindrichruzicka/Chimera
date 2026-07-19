import React from 'react';
import type { IconGlyph } from './registry';

// A 2×2 grid of rounded tiles — the "showcase of components" metaphor — drawn on
// a 24-unit grid with symmetric 3-unit margins and a 2-unit gutter. The path
// carries no `fill`: the shared `.icon { fill: currentColor }` rule colours it
// from the host's colour token, so the glyph tracks a control's variant and its
// hover/focus states for free (Invariant #86: no colour here).
export const galleryIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: (
        <path d="M4.5 3h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 3 9.5v-5A1.5 1.5 0 0 1 4.5 3zm10 0h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 13 9.5v-5A1.5 1.5 0 0 1 14.5 3zm-10 10h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 3 19.5v-5A1.5 1.5 0 0 1 4.5 13zm10 0h5a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5z" />
    ),
};
