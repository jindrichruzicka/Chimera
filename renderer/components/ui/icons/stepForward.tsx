import React from 'react';
import type { IconGlyph } from './registry';

// A hollow right-pointing triangle (the evenodd rule punches out the centre),
// drawn on a 20-unit grid — the mirror of the step-back glyph. The path carries
// no `fill`: the shared `.icon { fill: currentColor }` rule colours it from the
// host's colour token (Invariant #86: no colour here).
export const stepForwardIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path fillRule="evenodd" d="M6 4l8 6-8 6Zm2 3.7v4.6L11.1 10Z" />,
};
