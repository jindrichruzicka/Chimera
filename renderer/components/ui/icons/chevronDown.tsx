import React from 'react';
import type { IconGlyph } from './registry';

// A downward chevron, drawn on a 20-unit grid. The path carries no `fill`: the
// shared `.icon { fill: currentColor }` rule colours it from the host's colour
// token (Invariant #86: no colour here).
export const chevronDownIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M4 7.4 5.4 6 10 10.6 14.6 6 16 7.4 10 13.4z" />,
};
