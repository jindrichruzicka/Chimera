---
title: 'GameShell, GameScreenRegistry, Renderer Contexts & UI Design System'
description: 'GameScreenRegistry interface (board required; hud/screens/transitionOverlay optional), GameShell.tsx rendering contract, within-scene screen navigation (useActiveScreen/useNavigateToScreen), Renderer Context Map (AssetManagerContext/ContentDatabaseContext/AudioManagerContext/DeviceInfoContext/FadeContext), null-bang prohibition, UI design token system (--ch-* tokens), component categories, game token overrides, and code splitting (registry-level dynamic import + screen-level React.lazy).'
tags: [renderer, react, game-screen-registry, contexts, design-tokens, code-splitting, gameshell]
---

# GameShell, GameScreenRegistry, Renderer Contexts & UI Design System

> §4.33–§4.36 of the Chimera architecture.
> Related: [Renderer State Stores](renderer-state-stores.md) · [Scene Transitions & Fade](scene-transitions-fade.md) · [Asset Reference System](asset-reference-system.md) · [Performance HUD & Device Info](performance-hud-device-info.md)

---

## 4.33 Game Screen Registry

### Overview

`GameShell.tsx` renders the match experience without knowing which game it is rendering. The contract between a game and the engine is `GameScreenRegistry`: a typed object mapping slot names to React component types.

### GameScreenRegistry Interface

```typescript
// renderer/components/shell/GameShell.tsx (exported for game packages to satisfy)

export interface GameScreenRegistry {
    readonly board: React.ComponentType; // Required — primary gameplay view
    readonly hud?: React.ComponentType<GameHudProps>; // Optional game-defined game HUD
    readonly screens?: Readonly<Record<string, React.ComponentType>>; // Named full-screen panels
    readonly transitionOverlay?: React.ComponentType; // Optional; engine default used when absent
    readonly gameResultBanner?: React.ComponentType<GameResultBannerProps>; // Optional winner display
}

export interface GameHudProps extends GameScreenProps {
    readonly tick: number;
    readonly undoDisabled: boolean;
    readonly redoDisabled: boolean;
    readonly endTurnDisabled: boolean;
    readonly handleUndo: () => void;
    readonly handleRedo: () => void;
    readonly handleEndTurn: () => void;
    // Host-only in-game save (Invariant #25). Deliberately NOT a disabled/handle
    // pair: ABSENCE of the prop is the withholding mechanism — the shell omits it
    // for non-hosts, when no save handler is wired, or once controls lock.
    readonly saveGame?: (label: string) => void;
}

export interface GameResultBannerProps {
    readonly gameResult: GameResult;
    readonly localPlayerId?: PlayerId;
}
```

### Game Registration Pattern

```typescript
// games/<game>/screens/index.ts
const BoardScreen = React.lazy(() => import('./BoardScreen'));
const GameHud = React.lazy(() => import('./GameHud'));
const TechTreeScreen = React.lazy(() => import('./TechTreeScreen'));
const DetailScreen = React.lazy(() => import('./DetailScreen'));
const SecondaryScreen = React.lazy(() => import('./SecondaryScreen'));
const GameResultBanner = React.lazy(() => import('./GameResultBanner'));

export const gameScreenRegistry: GameScreenRegistry = {
    board: BoardScreen,
    hud: GameHud,
    gameResultBanner: GameResultBanner,
    screens: {
        'tech-tree': TechTreeScreen,
        secondary: SecondaryScreen,
        detail: DetailScreen,
    },
};
```

### GameShell Resolution

```typescript
// renderer/app/game/page.tsx
async function loadRegistry(gameId: string): Promise<GameScreenRegistry> {
    switch (gameId) {
        case '<game>':
            return (await import('../../games/<game>/screens/index')).gameScreenRegistry;
        default:
            throw new Error(`No screen registry for game '${gameId}'`);
    }
}
```

### Within-Scene Screen Navigation

```typescript
// renderer/hooks/useScreenNav.ts

/** Active screen key for the current scene. Defaults to 'board' on scene entry. */
export function useActiveScreen(): string;

/** Navigate to a named screen. 'board' always returns to the primary view. */
export function useNavigateToScreen(): (screenKey: string) => void;
```

These hooks read/write `uiStore.activeScreenKey`. No IPC involved. `SceneRouter` resets the key to `'board'` on every `sceneId` change in `PlayerSnapshot`.

### GameShell Rendering Contract

```typescript
interface GameShellProps {
    registry: GameScreenRegistry;
}

/**
 * Responsibilities:
 *   1. Mount active screen from registry (driven by useActiveScreen)
 *   2. Build engine-owned HUD props and render registry.hud when present
 *   3. Render built-in engine UI: PerfHud, ToastHost
 *   4. Pass all engine contexts down the tree (§4.34)
 *   5. Gate screen components behind React.Suspense
 *   6. Delegate scene transitions to SceneRouter (§4.18)
 *   7. Delegate resolved game-result presentation to registry.gameResultBanner when present
 */
export function GameShell({ registry }: GameShellProps): JSX.Element;
```

`registry.hud` is a presentation override only. `GameShell` derives the common engine control
surface (`tick`, undo/redo/end-turn disabled states, and guarded handlers) from the projected
`PlayerSnapshot` plus injected action callbacks. Game HUD components should render those props and
call `handleUndo`, `handleRedo`, and `handleEndTurn`; they should not construct `engine:undo`,
`engine:redo`, or `engine:end_turn` actions themselves. If a game omits `hud`, `GameShell` renders
the engine fallback HUD with the stable `hud-tick`, `undo`, `redo`, and `end-turn` test IDs.

Game-provided HUDs that replace the fallback should preserve those test IDs for the equivalent
controls when the E2E page object needs to drive the match generically.

When `PlayerSnapshot.gameResult` is non-null, `GameShell` renders `registry.gameResultBanner`
with `{ gameResult, localPlayerId }`. If the game omits the slot, `GameShell` uses the engine
fallback text (`You won`, `You lose`, or `Draw`). Game-provided result banners should expose
`data-testid="game-result-banner"` on the banner root, `data-testid="game-result-text"` on the
primary message, and `data-game-result-outcome` on the banner root to keep Playwright page objects
stable across games.

### Invariants

| #   | Rule                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #80 | `GameShell.tsx` must never import from any `games/*` path. `GameScreenRegistry` is the sole coupling point.                                                      |
| #81 | `GameScreenRegistry.board` is the only required slot. A game providing only `board` is fully valid.                                                              |
| #82 | Within-scene panel navigation (`useNavigateToScreen`) is renderer-local state. It must never trigger an IPC call, advance `tick`, or dispatch an `EngineAction`. |

---

## 4.34 Renderer Contexts — Core Service Injection

### Context Map

| Context                  | Value type        | Hook                   | Source                              | Cleared on  |
| ------------------------ | ----------------- | ---------------------- | ----------------------------------- | ----------- |
| `AssetManagerContext`    | `AssetManager`    | `useAssetManager()`    | Created at game start; see §4.10    | session end |
| `ContentDatabaseContext` | `ContentDatabase` | `useContentDatabase()` | Loaded at game init; see §4.8       | session end |
| `AudioManagerContext`    | `AudioManager`    | `useAudioManager()`    | Created at game start; see §4.25    | session end |
| `DeviceInfoContext`      | `DeviceInfo`      | `useDeviceInfo()`      | Polled from main process; see §4.17 | —           |
| `FadeContext`            | `FadeControl`     | `useFade()`            | `TransitionOverlay`; see §4.19      | —           |

### Context Declarations

```typescript
// Pattern: createContext<T | null>(null) + throwing hook — mandatory for all contexts

export const AssetManagerContext = createContext<AssetManager | null>(null);
export function useAssetManager(): AssetManager {
    const ctx = useContext(AssetManagerContext);
    if (!ctx) throw new Error('useAssetManager() must be used inside <GameShell>.');
    return ctx;
}
// Same pattern for ContentDatabaseContext, AudioManagerContext
```

### Provider Wiring in GameShell

```typescript
export function GameShell({ registry }: GameShellProps): JSX.Element {
    const assetManager    = useGameAssetManager();
    const contentDatabase = useGameContentDatabase();
    const audioManager    = useGameAudioManager();

    return (
        <AssetManagerContext.Provider value={assetManager}>
        <ContentDatabaseContext.Provider value={contentDatabase}>
        <AudioManagerContext.Provider value={audioManager}>
            <SceneRouter registry={registry} />
        </AudioManagerContext.Provider>
        </ContentDatabaseContext.Provider>
        </AssetManagerContext.Provider>
    );
}
```

### Module Tree

```
renderer/assets/
└── AssetManagerContext.ts        # Context + useAssetManager()

renderer/content/
└── ContentDatabaseContext.ts     # Context + useContentDatabase()

renderer/audio/
└── AudioManagerContext.ts        # Context + useAudioManager()
```

`DeviceInfoContext` → §4.17 · `FadeContext` → §4.19.

### Invariants

| #   | Rule                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #83 | All engine-provided React contexts use `createContext<T \| null>(null)`. Consumer hooks throw if context is `null`. `createContext<T>(null!)` (null-bang) is forbidden. |
| #84 | Game screen components must not import `AssetManager`, `ContentDatabase`, or `AudioManager` as singleton imports. All access goes through context hooks.                |

---

## 4.35 UI Design System (`renderer/components/ui/`)

### Component Categories

| Category       | Examples                                                 |
| -------------- | -------------------------------------------------------- |
| **Actions**    | `Button`, `IconButton`, `ToggleButton`, `SaveGameButton` |
| **Overlays**   | `Modal`, `Drawer`, `Tooltip`, `Popover`                  |
| **Containers** | `Panel`, `Card`, `Divider`, `ScrollArea`, `Tabs`         |
| **Forms**      | `Slider`, `Toggle`, `TextInput`, `Select`, `NumberInput` |
| **Feedback**   | `ProgressBar`, `Spinner`, `Badge`                        |
| **Typography** | `Heading`, `Label`, `Caption`                            |
| **Media**      | `PreloadedImage`                                         |

All components are **unstyled except for CSS tokens**. No hardcoded hex values.

**`Modal`** is a chrome-less, game-UI overlay — no panel, border, radius, or shadow.
It renders only a full-screen backdrop (`--ch-color-overlay-backdrop`, opaque by default;
override the token for a semi-transparent, see-through scrim), a **centered title**, the
content (which scrolls vertically past a height threshold while the title and buttons stay
pinned), and a **right-aligned** control row. There is no header close (×) button.
Buttons are supplied via the `actions` prop —
`readonly { label, onClick?, variant?, testId?, disabled?, dismiss?, ariaDescribedBy? }[]`; each button runs its
optional `onClick` and then dismisses the modal, unless `dismiss: false` opts out for actions
that operate in place (a settings Reset, a lobby Host/Join). When `actions` is omitted, a single
`Close` button is rendered that just dismisses; an explicit empty array renders **no action row
at all** (for surfaces whose controls all live in the body).
`actionsTestId` forwards a `data-testid` to the action row. Escape also dismisses (via the
shared `EscapeStack`).

Geometry comes from the `size` preset — `md` (default; decision dialogs), `lg`
(browser/workspace surfaces: settings, saves, replays), `xl` (the widest shell surface: the
lobby) — surfaced on the dialog as `data-ch-modal-size`. `fixedHeight` pins the dialog to one
static block-size regardless of content (surfaced as `data-ch-modal-fixed-height`), so body
swaps such as settings tab switches never resize it; the body then owns internal scrolling.
Modals nest: the focus trap is active only while a modal is the **topmost** layer of the
`EscapeStack` (`useEscapeLayer(...).isTopLayer()`), so a confirm Modal opened over a page-level
Modal owns both Escape and Tab until it closes.

**`SaveGameButton`** is the Actions category's one composite: a save trigger that opens a
save-name prompt (`Modal` + `TextInput`, name bounded to `MAX_SAVE_LABEL_LENGTH`) and calls
`onSave(trimmedLabel)` exactly once on confirm; the label resets each time the dialog opens.
The trigger takes two forms via `trigger`: the default `'button'` (a compact labelled
`Button`) and `'icon'` — a borderless ghost `IconButton` carrying the `save` glyph for
icon-driven surfaces such as a game's command bar, named for assistive tech via `aria-label`
(plus a hover `title`) from the same translated save label. It is a pure callback component —
no stores or IPC — so a game HUD renders it only when it received the host-only
`GameHudProps.saveGame` capability (see §4.33) and passes that capability through as `onSave`.

**`PreloadedImage`** is the Media category's one primitive: a `next/image` wrapper that holds
the img at `opacity: 0` until `img.decode()` settles, so the first paint of the picture is the
complete bitmap — never a progressively streamed/decoded partial frame ("tearing"). Defaults to
`priority` (eager fetch + exported `<head>` preload on static pages); fails open on decode
rejection or missing `img.decode()`; preserves the caller's `style` (including custom `opacity`)
once revealed. Pair with game-declared warm-up via `LoadedRendererGameShell.preloadImages` for
pictures that appear after initial navigation, and keep sources near display size — see
§4.37.13 (Game Image Preloading) in the shell pages contract.

### Game Surface Consumption

Game-owned renderer surfaces may use the shared component library for HUDs,
in-match menus, result banners, post-game summaries, and similar UI. The library
exposes **three** public barrels, and those are the only renderer import surfaces a
game may use:

```typescript
// Tier 1 — stateless design primitives (this section, §4.35):
import { Button, Card, Heading } from '@chimera-engine/renderer/components/ui/index.js';

// Tier 2 — the shared chat component (§4.35.1):
import { ChatPanel } from '@chimera-engine/renderer/components/chat';

// Tier 3 — engine components a game mounts inside its own <Canvas> (§4.16):
import { PerfProbe } from '@chimera-engine/renderer/components/r3f';
```

This allowance applies only to React components under `games/<name>/screens/*.tsx`
and React shell contributions under `games/<name>/shell/*.tsx`. Game actions,
state, projection, AI, content, and non-React shell definition files must not
import renderer code. Game renderer surfaces also must not import renderer stores,
IPC bridges, `shell/` components, R3F components outside the r3f barrel, asset
managers, hooks, stylesheets, or individual component files behind any barrel —
only the three barrels above. Token overrides remain the mechanism for game
visual customization.

### 4.35.1 Chat Component (`renderer/components/chat/`)

The chat barrel is the second tier of the shared component library: a higher-level,
**stateful** feature component wired to renderer stores and the host IPC bridge — in
contrast to the stateless primitives of `renderer/components/ui/`. It carries a
different stability and review bar, so it lives behind its own public specifier
`@chimera-engine/renderer/components/chat` (whitelisted alongside the UI barrel by the
`chimera/no-game-renderer-internals` lint rule; deep imports into the directory stay
forbidden).

| Component   | Source                                   | Notes                                       |
| ----------- | ---------------------------------------- | ------------------------------------------- |
| `ChatPanel` | `renderer/components/chat/ChatPanel.tsx` | In-match chat UI; see §4.29. Game-agnostic. |

The engine never mounts `ChatPanel` — no engine shell surface (lobby included)
renders chat. A game mounts it from one of its own renderer surfaces — Tactics
renders it inside `TacticsGameHud` (a sibling of the HUD footer), and the panel
owns its own positioning.

### 4.35.2 Icon System & Game-Contributed Icons (`renderer/components/ui/icons/`)

`<Icon name>` renders a named glyph as a tokenized, `currentColor` SVG. A glyph is
an `IconGlyph` — `{ viewBox, content }` where `content` is fill-based SVG children
that carry **no `fill`** (colour comes from the shared `.icon { fill: currentColor }`
rule, sized by `--ch-size-icon`), so a glyph tracks its host control's colour token
and hover/focus states (Invariant #86). The engine ships ~13 built-ins in
`ICON_REGISTRY`; `IconName = keyof typeof ICON_REGISTRY` is derived structurally
(no hand-maintained union). Inside an `<IconButton>` the glyph is passed as
children and picks up the button's colour + `--ch-icon-button-glyph-size`.

A game contributes **its own** glyphs — the icon analog of the `translations` seam:

- **Author** a `GameIconSet` (`Readonly<Record<string, IconGlyph>>`) on the same
  fill-based contract, keys namespaced `game.<gameId>.<name>` (e.g.
  `apps/tactics/shell/icons.tsx`).
- **Contribute** it via `LoadedRendererGameShell.icons`, forwarded verbatim from the
  game's `loaders.ts` (§4.37.16). Because glyphs are inline React content — not
  image files — they travel on the renderer shell payload, **not** the manifest
  (unlike the hardware cursor).
- **Resolve**: `useActiveGameIcons` reads `shell.icons` from the registry, and the
  app-wide `ActiveGameIconProvider` (mounted in `AppShell`) publishes it to
  `IconContext`. `<Icon>` reads the context and resolves **game-first,
  engine-fallback** (`gameIcons?.[name] ?? ICON_REGISTRY[name]`).

So `<Icon name="game.tactics.banner" />` renders the game's glyph with the engine's
`currentColor` + token sizing — identical to a built-in, including inside an
`<IconButton>` — and a game may **re-skin** a built-in by re-keying its name. An
**unknown** name (no engine or game glyph) renders nothing and dev-warns rather than
crashing (the previously unguarded `ICON_REGISTRY[name]` lookup would throw). The
`name` prop is typed `IconName | (string & {})`: built-in names keep autocomplete and
typo-checking, while a game name is any string, validated at runtime by the guard.

The public `components/ui` barrel exposes `Icon`, `IconProvider`, and the
`GameIconSet`/`IconGlyph`/`IconName` types, but deliberately **withholds**
`ICON_REGISTRY` — games consume icons only through `<Icon name>` (Invariants #96,
#113). `IconContext` uses the `null` default but exposes no throwing consumer hook:
bare `<Icon>` with no provider degrades to the engine registry (the carve-out on
Invariant #83). See §4.37.16 for the full registry-payload contract.

### Primitive State Attributes

UI primitives expose stable `data-ch-*` attributes for public visual state that
is derived from component props, such as `data-ch-button-variant`,
`data-ch-card-surface`, `data-ch-card-padding`, and `data-ch-card-elevation`.
Overlay primitives (`Modal`, `Drawer`) additionally expose
`data-ch-state="open" | "closing"` on their backdrop while mounted — the
`closing` value drives the exit animation (see Motion & Animation below).
Tests may assert these attributes to verify that renderer surfaces are consuming
the shared primitive contract. These attributes are not styling escape hatches;
visual customization still flows through tokens and component props.

### Keyboard Focus (`:focus-visible`)

Every interactive primitive draws its keyboard-focus indicator **at or inside
its border-box**, so an `overflow` ancestor (a scroll container such as the
Tabs tablist) can never clip the indicator into a stray sliver. There is
deliberately no offset token for an outside halo ring.

Two forms, both driven by `--ch-focus-ring-width` and `--ch-focus-ring-color`.
The engine default ring color is `--ch-color-text-secondary` (a neutral grey) —
deliberately **not** `--ch-color-accent-hover`, which already paints the active
tab chrome and the primary button border in the engine palette, so an
accent-hover ring would be invisible on exactly the states keyboard users land
on. Games theme the ring by overriding `--ch-focus-ring-color` (Tactics points
it at its gold `--ch-color-accent`):

- **Bordered components** (Tabs, Button, IconButton, ToggleButton, Toggle
  track, TextInput, NumberInput, Select shell) recolor their existing border to
  `var(--ch-focus-ring-color)` and add a transparent inset outline
  (`outline: var(--ch-focus-ring-width) solid var(--ch-color-transparent);
outline-offset: calc(var(--ch-focus-ring-width) * -1)`) so forced-colors
  modes still draw an indicator.
- **Borderless components** (Slider's range input, full-row list buttons)
  draw the same inset outline in `var(--ch-focus-ring-color)` instead.

Accent-on-accent collisions get a second cue: `Button`/`IconButton` focus also
applies the hover backdrop (background + shadow) so primary variants still
light up in palettes that point the ring at the accent (as Tactics does),
where the resting primary border matches the focus-ring color;
`ToggleButton` raises only the hover shadow (a backdrop swap would visually
un-press a focused pressed toggle); the checked `Toggle` track swaps its focus
border to `--ch-color-text-primary`.

The executable contract is `renderer/components/ui/focusStyles.test.ts`.

### Component Gallery (`/component-gallery/`)

`renderer/app/component-gallery/` is a **development and E2E-only** visual fixture for the §4.35 primitive library. It is gated by `isGalleryEnabled()` (active in any non-production `NODE_ENV` — i.e. `development`, `test`, or any value other than `production` — and when `NEXT_PUBLIC_CHIMERA_E2E=1` regardless of environment) and is not part of the production navigation tree.

The gallery covers all six §4.35 primitive categories — **Actions**, **Overlays**, **Containers**, **Forms**, **Feedback**, and **Typography** — each rendered as a named section. The top-level category navigation is implemented with `Tabs` (from the Containers category), making the gallery the primary live demonstration of that component. The gallery also includes a **Toasts** dev tab for exercising the §4.30 `toastStore` and `ToastHost` stack.

Boundary rules (invariants [#93](../executive-architecture/architecture-invariants.md) and [#94](../executive-architecture/architecture-invariants.md)): the gallery must not import from any `games/*` path, and must not directly import game token override CSS — overrides enter the cascade only as side-effects of game registry initialisation (§4.36).

### Design Token Naming: `--ch-<category>-<variant>`

The catalogue below is representative, not exhaustive — per-variant button
colour/background/border tokens, the IconButton and ToggleButton groups, and layout calibration
tokens follow the same naming pattern. The authoritative inventory is `renderer/styles/tokens.css`
itself, locked token-for-token by `renderer/styles/tokens.test.ts`.

```css
/* renderer/styles/tokens.css — engine defaults */

/* ── Colour ─────────────────────────────────────────────────
 * Neutral shell ladder (surface < raised < overlay) plus translucent state
 * layers that compose over any tier: hover is a plain white veil, selected
 * carries the accent tint. */
--ch-color-surface: #111113;
--ch-color-surface-raised: #1b1b1f;
--ch-color-surface-overlay: #27272a;
--ch-color-surface-hover: rgba(244, 244, 245, 0.06);
--ch-color-surface-selected: rgba(161, 161, 170, 0.16);
--ch-color-scrim: #000000;
--ch-color-overlay-backdrop: #27272a; /* Modal full-screen scrim; games override for a see-through backdrop */
--ch-overlay-backdrop-blur: 0; /* backdrop-filter blur behind the Modal scrim; 0 = none, games raise it for frosted glass */

/* Accent ramp — a neutral grey ramp with no brand tint, separated from the
 * shell only by lightness. accent is the resting interactive fill and
 * accent-hover its hover step (both dark enough to carry text-primary at AA;
 * accent-hover also paints the active tab chrome and the primary button
 * border); accent-strong lifts to a light grey for graphical indicators
 * (spinner segment, slider/meter fills) that need 3:1 against borders and
 * tracks. Games override the accent to add colour. */
--ch-color-accent: #3f3f46;
--ch-color-accent-hover: #52525b;
--ch-color-accent-strong: #a1a1aa;

--ch-color-text-primary: #f4f4f5;
--ch-color-text-secondary: #a1a1aa;
--ch-color-text-disabled: #71717a;

/* Border emphasis orders muted < border < strong. */
--ch-color-border-muted: #27272a;
--ch-color-border: #3f3f46;
--ch-color-border-strong: #52525b;

/* Semantic states — one symmetric dark-native quartet per state. The base
 * token is the solid fill that carries text-primary (warning is the exception
 * and pairs with dark text); -text holds AA on every shell surface and on its
 * own state surface; -surface is the tinted box background; -border the box
 * boundary. Compose surface + border + text for state boxes, use base for
 * solid fills, and -text alone for inline state copy. Warning is the Chimera
 * brand orange rgb(249, 115, 22) verbatim; error and success are tuned as its
 * siblings (700-step bases, vivid 400-step texts), and all three quartets
 * share one border/surface lightness recipe. */
--ch-color-success: #15803d; /* + -text / -surface / -border */
--ch-color-warning: #f97316; /* + same quartet */
--ch-color-error: #b91c1c; /* + same quartet */

/* ── Spacing ─────────────────────────────────────────────── */
--ch-space-xs: 4px;
--ch-space-sm: 8px;
--ch-space-md: 16px;
--ch-space-lg: 24px;
--ch-space-xl: 40px;

/* ── Radius ──────────────────────────────────────────────── */
--ch-radius-sm: 4px;
--ch-radius-md: 8px;
--ch-radius-lg: 12px;
--ch-radius-pill: 999px;

/* ── Typography ──────────────────────────────────────────── */
--ch-font-ui: 'Inter', system-ui, sans-serif;
--ch-font-game: 'Tahoma', serif;
--ch-font-mono: 'JetBrains Mono', monospace;
--ch-font-size-sm: 12px;
--ch-font-size-md: 14px;
--ch-font-size-lg: 18px;
--ch-font-size-xl: 24px;
--ch-font-weight-regular: 400;
--ch-font-weight-semibold: 600;
--ch-font-weight-bold: 700;
--ch-line-height-none: 1;
--ch-line-height-tight: 1.1;
--ch-line-height-relaxed: 1.6;

/* ── Text Treatment ─────────────────────────────────────────
 * Gradient fill + outline for the typography roles. The base --ch-text-*
 * tokens feed every role; each role can also be themed independently:
 * title (Modal/Drawer page titles), heading (Heading component), label
 * (Label), caption (Caption). Engine defaults are visually inert — gradient
 * stops resolve to currentColor and the outline is 0px transparent — so
 * every tone, state, and inline colour override keeps rendering its plain
 * colour until a game overrides the tokens. Semantic states (disabled
 * labels, error/success captions, the required/optional label markers)
 * always render plain even in themed games: decoration never overrides
 * feedback. */
--ch-text-fill-top: currentColor;
--ch-text-fill-bottom: currentColor;
--ch-text-outline-width: 0px;
--ch-text-outline-color: var(--ch-color-transparent);
--ch-title-fill-top: var(--ch-text-fill-top); /* + -fill-bottom / -outline-width / -outline-color */
--ch-heading-fill-top: var(--ch-text-fill-top); /* + same quartet */
--ch-label-fill-top: var(--ch-text-fill-top); /* + same quartet */
--ch-caption-fill-top: var(--ch-text-fill-top); /* + same quartet */

/* ── Opacity ─────────────────────────────────────────────── */
--ch-opacity-soft: 0.4; /* de-emphasised chrome */
--ch-opacity-disabled: 0.6; /* disabled controls */
--ch-opacity-full: 1;

/* ── Z-Index ─────────────────────────────────────────────────
 * The complete stacking contract, lowest to highest — tokens.test.ts asserts
 * the ladder stays strictly increasing: shell background, raised in-page
 * chrome (HUD docks, toggle thumbs), tooltip/popover, modal/drawer, toasts
 * (must clear open modals), connection status (visible through everything
 * interactive), scene fade, app screen fade. */
--ch-z-base: 0;
--ch-z-raised: 1;
--ch-z-tooltip: 90;
--ch-z-modal: 100;
--ch-z-toast: 110;
--ch-z-status: 120;
--ch-z-scene-fade: 130;
--ch-z-screen-fade: 140;

/* ── Shadows & Glows ─────────────────────────────────────────
 * Layered ambient + key shadows; the glows pair with them for hover accents
 * (button hover shadows compose as shadow-md + glow, see below). */
--ch-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.22);
--ch-shadow-md: 0 2px 4px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.26);
--ch-shadow-lg: 0 4px 8px rgba(0, 0, 0, 0.38), 0 12px 32px rgba(0, 0, 0, 0.32);
--ch-glow-accent: 0 0 16px rgba(82, 82, 91, 0.35);
--ch-glow-danger: 0 0 16px rgba(185, 28, 28, 0.35);

/* ── Button Shape & Elevation (representative) ──────────────
 * The full group also carries per-variant color/bg/border (+ -hover) tokens
 * and a sm|md|lg size scale (font-size / line-height / padding / min-width),
 * plus the parallel IconButton and ToggleButton groups — see tokens.css. */
--ch-button-radius: var(--ch-radius-md);
--ch-button-font-weight: 700;
--ch-button-shadow: var(--ch-shadow-sm);
--ch-button-shadow-hover: var(--ch-shadow-md), var(--ch-glow-accent);
--ch-button-shadow-hover-danger: var(--ch-shadow-md), var(--ch-glow-danger);
--ch-button-transform: scale(1);
--ch-button-transform-hover: scale(1.02);
--ch-button-transform-active: scale(0.98);

/* ── Slider ──────────────────────────────────────────────────
 * Custom-drawn range input: a slim pill track whose filled portion uses the
 * strong accent (3:1+ against the track) under a round thumb ringed with the
 * surface colour so it stays crisp over both halves. */
--ch-slider-track-size: 6px;
--ch-slider-track-color: var(--ch-color-border);
--ch-slider-fill-color: var(--ch-color-accent-strong);
--ch-slider-thumb-size: 16px;
--ch-slider-thumb-color: var(--ch-color-text-primary);
--ch-slider-thumb-border-color: var(--ch-color-surface);

/* ── Cursors ─────────────────────────────────────────────────
 * Every engine cursor style routes through these tokens, so a game can
 * replace the OS cursor purely via token overrides. Declaring
 * `GameManifest.cursor` forwards through `LoadedRendererGameShell.cursor`
 * into `renderer/game/gameCursorStyles.ts`, which injects
 * `url(chimera://…) <x> <y>, <fallback>` values at registry init
 * (§4.37.14). Engine defaults keep the plain system cursor. */
--ch-cursor-default: auto;
--ch-cursor-pointer: pointer;
--ch-cursor-disabled: not-allowed;
--ch-cursor-hidden: none; /* Boot logo screen suppresses the OS cursor; games may remap to a bespoke cursor */

/* ── Motion ──────────────────────────────────────────────── */
--ch-duration-fast: 120ms;
--ch-duration-normal: 250ms;
--ch-duration-slow: 400ms;
/* Directional easing vocabulary: standard for in-place state changes,
 * decelerate for elements entering the screen, accelerate for exits. */
--ch-easing-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ch-easing-decelerate: cubic-bezier(0, 0, 0.2, 1);
--ch-easing-accelerate: cubic-bezier(0.4, 0, 1, 1);

/* ── Feedback Motion ─────────────────────────────────────────
 * Spinner rotation and toast entrances follow the same name/duration/easing
 * pattern as the overlays; the -reduced-name variant is the plain fade the
 * ToastHost swaps in when the OS prefers reduced motion. */
--ch-spinner-anim-name: ch-spinner-rotate; /* + -duration (slow) / -easing */
--ch-toast-anim-enter-name: ch-toast-enter;
--ch-toast-anim-enter-reduced-name: ch-toast-fade-in;
--ch-toast-anim-enter-duration: var(--ch-duration-normal);
--ch-toast-anim-enter-easing: var(--ch-easing-decelerate);

/* ── Overlay Motion (see "Motion & Animation" below) ────────
 * Modal/Drawer open-close animations. Per component (backdrop, modal, drawer)
 * and per phase (enter, exit) there are -name / -duration / -easing tokens;
 * names point at global keyframes in renderer/styles/animations.css. Enters
 * decelerate in over the normal duration; exits accelerate away over the
 * fast one. */
--ch-backdrop-anim-enter-name: ch-backdrop-enter;
--ch-backdrop-anim-enter-duration: var(--ch-duration-normal);
--ch-backdrop-anim-enter-easing: var(--ch-easing-decelerate);
--ch-backdrop-anim-exit-name: ch-backdrop-exit; /* + -duration (fast) / -easing (accelerate) */
--ch-modal-anim-enter-name: ch-modal-enter; /* + exit triple */
--ch-drawer-anim-enter-name: ch-drawer-enter; /* + exit triple */
--ch-drawer-slide-distance: 100%;
```

### Contrast Contract

`renderer/styles/tokens.test.ts` computes WCAG contrast ratios from the literal token values, so a
palette regression fails unit tests before it ships: primary and secondary text hold AA (4.5:1) on
every shell surface tier; primary text holds AA on the accent, accent-hover, and error fills; each
semantic state's `-text` holds AA on every shell surface and on its own state surface; the strong
accent holds 3:1 non-text contrast (WCAG 1.4.11) against the border and raised-surface chrome it
draws over; and the semantic state borders stay visible against the raised surface. Game overrides
load outside these tests — a game that overrides colour tokens owns the same contrast obligations
itself.

### Game Token Overrides

Games inject a CSS file as a side-effect import:

```css
/* games/<game>/styles/tokens-override.css */
--ch-color-surface: #0d1117;
--ch-color-accent: #58a6ff;
--ch-radius-md: 2px;
```

```typescript
// games/<game>/screens/index.ts
import './styles/tokens-override.css'; // side-effect; redefines tokens for this game
```

Games may only override tokens declared in `renderer/styles/tokens.css`. Inventing new `--ch-*` token names is prohibited (invariant #85).

Font-family tokens may reference game-contributed font faces only after the game declares those
faces through `LoadedRendererGameShell.fonts` (§4.37.7). The font files must be self-hosted local
assets, not runtime Google Fonts URLs. For example, a game may declare local `.woff2` font files and
then override `--ch-font-game` and `--ch-font-ui` to `'MyFont', serif` in
`games/<game>/styles/tokens-override.css`.

### Motion & Animation

Engine UI motion comes in two layers, both fully token-parameterised (invariant #109):

1. **Component transitions** — hover/press/toggle feedback on the primitives, composed from the
   `--ch-duration-*` / `--ch-easing-*` primitives (e.g. `--ch-button-transition`; button press uses
   `:active` → `--ch-button-transform-active`).
2. **Keyframe animations** — `Modal` and `Drawer` play enter/exit animations driven by the
   `--ch-<component>-anim-<enter|exit>-<name|duration|easing>` tokens above (the drawer slides from
   its placement edge, the modal scales in as the shared backdrop fades; enters use the decelerate
   easing, exits accelerate). The `Spinner` rotation and toast entrance run through the same token
   pattern (`--ch-spinner-anim-*`, `--ch-toast-anim-enter-*`, including the reduced-motion
   `--ch-toast-anim-enter-reduced-name` fade).

**Keyframe contract.** `renderer/styles/animations.css` (imported by the root layout after
`tokens.css`) declares nine **global** keyframes: `ch-backdrop-enter/exit` (opacity fade),
`ch-modal-enter/exit` (transform-only scale — the backdrop owns opacity so the panel is never
double-faded), `ch-drawer-enter/exit` (translate), `ch-spinner-rotate` (continuous rotation with an
opacity pulse), `ch-toast-enter` (rise + fade), and `ch-toast-fade-in` (the reduced-motion toast
fade). These names are global on purpose: the `*-anim-*-name` tokens reference them, and CSS-module
keyframes are name-hashed, which would break that indirection —
`renderer/styles/animations.test.ts` ratchets this by failing if any renderer `*.module.css`
declares an `@keyframes` of its own. The drawer pair reads private per-placement offsets
(`--_ch-drawer-slide-x/y`) that `Drawer.module.css` sets per placement class from the public
`--ch-drawer-slide-distance` token, so all four placements share one keyframe pair.
`--_ch`-prefixed properties are engine-private wiring — not overridable surface.

**Exit presence.** Closing keeps the overlay mounted until every animated element's exit animation
finishes (`useExitPresence`, internal to `Modal`/`Drawer` — the `open`/`onClose` API is unchanged).
While closing, the overlay carries `data-ch-state="closing"`, is `inert`, and blocks pointer input.
When no exit animation is computable — `prefers-reduced-motion`, a `0ms` game override, or jsdom —
`open=false` unmounts synchronously, so tests and reduced-motion users see an instant close.

**Game override recipes** (all via `tokens-override.css`, per invariants #85/#93):

```css
/* 1. Retime — make overlay motion snappier or slower. */
--ch-modal-anim-enter-duration: var(--ch-duration-fast);

/* 2. Reshape — retarget a *-name token at your own game-namespaced keyframes
      (new keyframe names are fine; #85 polices only --ch-* property names). */
--ch-modal-anim-enter-name: mygame-modal-enter;
@keyframes mygame-modal-enter {
    /* declared in the game's override CSS */
    from {
        transform: translateY(var(--ch-space-lg));
    }
    to {
        transform: translateY(0);
    }
}

/* 3. Disable. */
--ch-drawer-anim-enter-duration: 0ms;
--ch-drawer-anim-exit-duration: 0ms;
```

**Reduced motion.** Engine durations reference the `--ch-duration-*` primitives, which the
`@media (prefers-reduced-motion: reduce)` block in `tokens.css` zeroes (and flattens the easings to
`linear`) — all engine motion collapses to instant automatically. A game override that sets
**literal** durations (`300ms` instead of `var(--ch-duration-*)`) outranks that block (game
overrides load later in the cascade) and must ship its own reduced-motion block. The JS-driven app
screen fades (route transitions and the boot sequence) sit outside the CSS cascade entirely, so
their duration source (`renderer/components/shell/screenFadeDuration.ts`) checks the preference
itself and returns `0` when reduced motion is requested.

### Component API Shape

```typescript
export interface ButtonProps {
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // default: 'primary'
    readonly size?: 'sm' | 'md' | 'lg'; // default: 'md'
    readonly disabled?: boolean;
    readonly onClick?: () => void;
    readonly className?: string;
    readonly style?: React.CSSProperties;
    readonly children: React.ReactNode;
}
```

No `theme` prop — tokens are the theming mechanism.

### Module Tree

```
renderer/
├── styles/
│   ├── animations.css
│   └── tokens.css
└── components/
    └── ui/
        ├── Button.tsx
        ├── Modal.tsx
        ├── Panel.tsx
        ├── Slider.tsx
        ├── TextInput.tsx
        └── ...
```

### Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #85  | Game token override files may only redefine tokens in `renderer/styles/tokens.css`. Introducing new `--ch-*` names in a game override is a module-boundary violation.                                                                                                                                                                                                                                                                                                                   |
| #86  | Engine UI components must not contain hardcoded colour, spacing, or radius values. Every visual attribute references `var(--ch-*)` or a scoped CSS Module class.                                                                                                                                                                                                                                                                                                                        |
| #96  | Game renderer surfaces may import the shared component library only through its three public barrels — `@chimera-engine/renderer/components/ui` (primitives), `@chimera-engine/renderer/components/chat` (the shared chat component), and `@chimera-engine/renderer/components/r3f` (engine components a game mounts inside its own `<Canvas>`); all other renderer internals stay off-limits.                                                                                          |
| #109 | Engine UI motion is declared as global `ch-*` keyframes in `renderer/styles/animations.css`, parameterised exclusively by `--ch-*` motion tokens; games customise motion only by overriding those tokens (retiming, `0ms`-disabling, or retargeting `*-name` tokens at game-namespaced keyframes), and all engine motion collapses to instant under `prefers-reduced-motion`.                                                                                                           |
| #113 | Game-contributed UI icons reach `<Icon>` only through the `LoadedRendererGameShell.icons` (`GameIconSet`) registry payload → `useActiveGameIcons` → `ActiveGameIconProvider`/`IconContext`; the engine icon module never imports `apps/*`, the public barrel withholds `ICON_REGISTRY`, resolution is game-first/engine-fallback, unknown names render nothing (dev-warn), and game glyphs carry no `fill` so they render like a built-in inside an `<IconButton>` (§4.35.2, §4.37.16). |

---

## 4.36 Game Screen Code Splitting

### Two Split Tiers

| Boundary                         | Mechanism          | When loaded                                   |
| -------------------------------- | ------------------ | --------------------------------------------- |
| **Game registry module**         | Dynamic `import()` | When game page mounts; after game ID is known |
| **Individual screen components** | `React.lazy()`     | On first render of that screen                |

### Registry-Level Split

```typescript
// renderer/app/game/page.tsx
async function loadRegistry(gameId: string): Promise<GameScreenRegistry> {
    switch (gameId) {
        case '<game>':
            return (await import('../../games/<game>/screens/index')).gameScreenRegistry;
        default:
            throw new Error(`No screen registry for game '${gameId}'`);
    }
}
```

### Screen-Level Split (inside `games/<name>/screens/index.ts`)

```typescript
const BoardScreen = React.lazy(() => import('./BoardScreen'));
const TechTreeScreen = React.lazy(() => import('./TechTreeScreen'));
```

### Suspense Integration

```typescript
// renderer/components/shell/GameShell.tsx
const ActiveScreen = resolveActiveScreen(registry, activeScreenKey);
return (
    <React.Suspense fallback={<ScreenLoadingFallback />}>
        <ActiveScreen />
    </React.Suspense>
);
```

`<ScreenLoadingFallback />` — neutral spinner; distinct from `TransitionOverlay` (§4.19). `TransitionOverlay` handles full-screen scene transitions; Suspense fallback handles within-scene first-visit screen loads.

### Invariants

| #   | Rule                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| #87 | Every screen component exported from `games/<name>/screens/index.ts` must be wrapped in `React.lazy()`. Eager static imports defeat the bundle split. |
| #88 | `GameShell` wraps every active screen in `<React.Suspense>`. No game screen may assume it renders without a Suspense ancestor.                        |

---

## Cross-References

- [Scene Transitions & Fade](scene-transitions-fade.md) — `SceneRouter`, `TransitionOverlay`, `useFade()` / `FadeContext`
- [Asset Reference System](asset-reference-system.md) — `AssetManagerContext`, `useAsset()`
- [Content Database & DataRefs](content-database-data-refs.md) — `ContentDatabaseContext`, `useContentDatabase()`
- [Audio System](audio-system.md) — `AudioManagerContext`, `useAudioManager()`
- [Performance HUD & Device Info](performance-hud-device-info.md) — `DeviceInfoContext`, `useDeviceInfo()`
- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 shell page token contract, `GameMainMenuDefinition`, game override cascade, invariants #80, #85, #91–#94
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #80–94
