import React from 'react';
import type { IconGlyph } from './registry';

// A right-pointing triangle against a stop bar, drawn on a 20-unit grid — the
// mirror of the seek-start glyph. The path carries no `fill`: the shared
// `.icon { fill: currentColor }` rule colours it from the host's colour token
// (Invariant #86: no colour here).
export const seekEndIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path d="M14 4h2v12h-2zM4 4l8 6-8 6z" />,
};
