import type { ReactNode } from 'react';
import { chatBubbleIcon } from './chatBubble';
import { chevronDownIcon } from './chevronDown';
import { closeIcon } from './close';
import { copyIcon } from './copy';
import { minusIcon } from './minus';
import { pauseIcon } from './pause';
import { playIcon } from './play';
import { plusIcon } from './plus';
import { saveIcon } from './save';
import { seekEndIcon } from './seekEnd';
import { seekStartIcon } from './seekStart';
import { stepBackIcon } from './stepBack';
import { stepForwardIcon } from './stepForward';

/**
 * The visual definition of one icon: its coordinate space and the SVG children
 * that draw it. `content` carries no `fill` — colour comes from CSS
 * `fill: currentColor`, so a glyph inherits whatever colour token its host
 * control resolves.
 *
 * The v1 glyph model is fill-based. A future stroke-only icon would render as a
 * filled blob; extend this shape (e.g. a `mode: 'fill' | 'stroke'` discriminant)
 * before adding one, rather than baking a `stroke`/`fill` attribute into a glyph.
 */
export interface IconGlyph {
    readonly viewBox: string;
    readonly content: ReactNode;
}

/**
 * The icon set. Add an icon by dropping a glyph module beside this file and
 * adding one `import` plus one entry here; `IconName` and every `<Icon name>`
 * call site update automatically. `satisfies` structurally validates each entry
 * while preserving the literal keys, so `keyof typeof` yields the exact name
 * union (no hand-maintained union to drift out of sync).
 */
export const ICON_REGISTRY = {
    'chat-bubble': chatBubbleIcon,
    'chevron-down': chevronDownIcon,
    close: closeIcon,
    copy: copyIcon,
    minus: minusIcon,
    pause: pauseIcon,
    play: playIcon,
    plus: plusIcon,
    save: saveIcon,
    'seek-end': seekEndIcon,
    'seek-start': seekStartIcon,
    'step-back': stepBackIcon,
    'step-forward': stepForwardIcon,
} satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof ICON_REGISTRY;
