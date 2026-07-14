import React from 'react';
import type { IconGlyph } from './registry';

// A plus sign, drawn on a 20-unit grid. The path carries no `fill`: the shared
// `.icon { fill: currentColor }` rule colours it from the host's colour token
// (Invariant #86: no colour here).
export const plusIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M9 4h2v5h5v2h-5v5H9v-5H4V9h5z" />,
};
