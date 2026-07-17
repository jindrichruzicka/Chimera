import React from 'react';
import type { IconGlyph } from './registry';

// A confirmation checkmark, drawn on a 20-unit grid. The path carries no
// `fill`: the shared `.icon { fill: currentColor }` rule colours it from the
// host's colour token (Invariant #86: no colour here).
export const checkIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M8.2 12.35 15.75 4.8l1.45 1.4-9 9L3.2 10.2l1.4-1.4z" />,
};
