import React from 'react';
import type { IconGlyph } from './registry';

// A rounded speech bubble with a tail at the bottom-left, drawn on a 24-unit
// grid. The path carries no `fill`: the shared `.icon { fill: currentColor }`
// rule colours it from the host's colour token, so the glyph tracks a control's
// variant and its hover/focus states for free (Invariant #86: no colour here).
export const chatBubbleIcon: IconGlyph = {
    viewBox: '0 0 24 24',
    content: <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />,
};
