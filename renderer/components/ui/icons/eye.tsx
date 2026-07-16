import React from 'react';
import type { IconGlyph } from './registry';

// An eye on a 20-unit grid: the filled lens with the iris ring punched out via
// even-odd and the pupil re-filled, so it reads at 20px. The path carries no
// `fill`: the shared `.icon { fill: currentColor }` rule colours it from the
// host's colour token (Invariant #86: no colour here).
export const eyeIcon: IconGlyph = {
    viewBox: '0 0 20 20',
    content: (
        <path
            fillRule="evenodd"
            d="M10 4.5C5.7 4.5 2.4 7.9 1.2 10c1.2 2.1 4.5 5.5 8.8 5.5s7.6-3.4 8.8-5.5C17.6 7.9 14.3 4.5 10 4.5Zm0 9a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm0-1.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
        />
    ),
};
