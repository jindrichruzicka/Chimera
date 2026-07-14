import React from 'react';
import type { IconGlyph } from './registry';

// A hollow left-pointing triangle (the evenodd rule punches out the centre),
// drawn on a 20-unit grid — the outline pairing to the solid play glyph. The
// path carries no `fill`: the shared `.icon { fill: currentColor }` rule
// colours it from the host's colour token (Invariant #86: no colour here).
export const stepBackIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: <path fillRule="evenodd" d="M14 4 6 10l8 6Zm-2 3.7v4.6L8.9 10Z" />,
};
