import type { ReactNode } from 'react';
import { chatBubbleIcon } from './chatBubble';
import { checkIcon } from './check';
import { chevronDownIcon } from './chevronDown';
import { closeIcon } from './close';
import { copyIcon } from './copy';
import { eyeIcon } from './eye';
import { minusIcon } from './minus';
import { pauseIcon } from './pause';
import { playIcon } from './play';
import { plusIcon } from './plus';
import { saveIcon } from './save';
import { seekEndIcon } from './seekEnd';
import { seekStartIcon } from './seekStart';
import { stepBackIcon } from './stepBack';
import { stepForwardIcon } from './stepForward';
import { swapIcon } from './swap';

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
    check: checkIcon,
    'chevron-down': chevronDownIcon,
    close: closeIcon,
    copy: copyIcon,
    eye: eyeIcon,
    minus: minusIcon,
    pause: pauseIcon,
    play: playIcon,
    plus: plusIcon,
    save: saveIcon,
    'seek-end': seekEndIcon,
    'seek-start': seekStartIcon,
    'step-back': stepBackIcon,
    'step-forward': stepForwardIcon,
    swap: swapIcon,
} satisfies Record<string, IconGlyph>;

export type IconName = keyof typeof ICON_REGISTRY;

/**
 * A game's contributed glyphs, keyed by the name a game passes to `<Icon name>`.
 * Same shape as the engine's own {@link ICON_REGISTRY} entries: each value is an
 * {@link IconGlyph} whose `content` carries no `fill` (colour comes from
 * `fill: currentColor`), so a game glyph tracks its host control's colour token
 * and `--ch-size-icon` sizing exactly like a built-in — including inside an
 * `<IconButton>`. Reaches `<Icon>` only through the registry shell seam
 * (`LoadedRendererGameShell.icons`) and the `IconProvider` context, never a
 * `renderer/` → `apps/*` import (Invariants #80/#94/#113). By convention a game
 * namespaces its keys `game.<gameId>.<name>` so a key never silently overrides
 * an engine built-in (which the game-first lookup in `<Icon>` would otherwise do).
 */
export type GameIconSet = Readonly<Record<string, IconGlyph>>;
