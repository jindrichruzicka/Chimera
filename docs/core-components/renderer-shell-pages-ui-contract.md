---
title: 'Renderer Shell Pages UI Contract'
description: 'Token-based styling contract for engine shell pages (main-menu, lobby, settings, saves). Defines which pages are shell-owned vs. game-owned, how the shared Button component is consumed, how GameMainMenuDefinition customizes the main menu, how GameSettingsPageDefinition customizes the settings page, how a game contributes a customizable LobbyScreen (host-authored match config), when game token overrides apply, and the invariants that prohibit inline styles on shell pages.'
tags:
    [
        renderer,
        ui,
        design-tokens,
        shell-pages,
        button,
        theming,
        lobby,
        main-menu,
        settings,
        game-shell-contract,
    ]
---

# Renderer Shell Pages UI Contract

> §4.37 of the Chimera architecture.
> Related: [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) · [Settings System](settings-system.md) · [Renderer State Stores](renderer-state-stores.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md)

---

## Overview

§4.35 defines the engine design-token system and `renderer/components/ui/` component library for
content that renders _inside_ `GameShell`. This section documents the same contract for
**engine shell pages** — top-level Next.js pages that exist outside of any game match:

Game renderer surfaces may also consume the public UI primitive barrel under the narrower §4.35
game-surface rule. Shell pages remain renderer-owned surfaces: they import UI primitives directly,
load game customization only through renderer registry helpers, and never import game screen modules
or token overrides directly.

| Page path                         | Purpose                                                             | Game-owned?                     |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| `renderer/app/main-menu/`         | Title screen, entry point                                           | Engine-owned; game-customizable |
| `renderer/app/lobby/`             | Route-backed modal for host/join/leave multiplayer lobby            | Partly\*                        |
| `renderer/app/settings/`          | Engine + game settings UI                                           | Engine-owned; game-customizable |
| `renderer/app/saves/`             | Save-slot browser                                                   | No                              |
| `renderer/app/(loading)/`         | Transition placeholder between scenes                               | No                              |
| `renderer/app/component-gallery/` | Design-system gallery (dev/E2E only); gated by `isGalleryEnabled()` | No                              |

\* The lobby page loads game-specific configuration from `LobbyConfig` for host/join requests, but
its chrome (dialog, tabs, buttons, layout, player list) is engine-owned. Game token overrides are
applied to the lobby page only when an explicit shell game context is present in the launch or route
URL (see §4.37.4); the lobby's runtime/default config does not invent shell theming context.

---

## 4.37.1 Token Requirement for Shell Pages

Shell pages consume the same `--ch-*` custom property set defined in `renderer/styles/tokens.css`
(§4.35). The root layout (`renderer/app/layout.tsx`) imports this stylesheet globally, so tokens
are always in scope.

**Rule:** No shell page component may use a hardcoded colour, spacing, or radius value — not even
as an inline `style` prop. Every visual attribute must reference a `var(--ch-*)` token or a scoped
CSS Module class whose declarations use `var(--ch-*)`.

```tsx
// ✅ Correct — token-referenced inline style (transitional; prefer CSS Module)
<button style={{ background: 'var(--ch-color-surface-raised)', color: 'var(--ch-color-text-primary)' }}>
    Play
</button>

// ✅ Correct — component from renderer/components/ui/
<Button variant="primary" onClick={...}>Play</Button>

// ❌ Wrong — hardcoded hex value
<button style={{ background: '#222', color: '#eee' }}>Play</button>

// ❌ Wrong — inline styles that bypass the token system entirely
const styles = { button: { background: '#222', border: '1px solid #555' } };
```

---

## 4.37.2 Shared `Button` Component on Shell Pages

Shell pages must use `renderer/components/ui/Button.tsx` (§4.35) for all interactive actions. The
full component API is reproduced here for reference:

```typescript
// renderer/components/ui/Button.tsx

export interface ButtonProps {
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // default: 'primary'
    readonly size?: 'sm' | 'md' | 'lg'; // default: 'md'
    readonly disabled?: boolean;
    readonly onClick?: () => void;
    readonly className?: string;
    readonly style?: React.CSSProperties; // token overrides only — no hardcoded values
    readonly children: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
```

### Variant Assignment Guide for Shell Pages

| Action                          | Variant     | Example usage             |
| ------------------------------- | ----------- | ------------------------- |
| Primary navigation / game start | `primary`   | Play, Start Game, Confirm |
| Secondary navigation / neutral  | `secondary` | Settings, Back            |
| Inline / low-prominence action  | `ghost`     | Cancel, Skip              |
| Destructive / irreversible      | `danger`    | Quit, Leave Lobby, Delete |

No custom `variant` values are permitted on shell pages. Games extend the visual language via
token overrides (§4.37.4), not by inventing new variant names.

---

## 4.37.3 Layout Tokens for Shell Pages

Shell page containers should also use tokens rather than hardcoded layout values:

```tsx
// renderer/app/main-menu/page.tsx — after migration
<main
    data-testid="main-menu"
    style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 'var(--ch-space-sm)',
    }}
>
    <Button variant="primary" onClick={() => router.push('/lobby')}>
        Play
    </Button>
    <Button variant="secondary" onClick={() => router.push('/settings')}>
        Settings
    </Button>
    <Button variant="danger" onClick={quit}>
        Quit
    </Button>
</main>
```

---

## 4.37.4 Game Token Overrides on Shell Pages

When a game is in context, shell-level UI may load the game's renderer shell contribution through
the renderer game registry. This context is explicit launch or URL state such as
`/main-menu/?gameId=<game>`, `/settings/?gameId=<game>`, or `/lobby/?gameId=<game>`; it does not
require a running lobby to exist. The default production launch route carries the built-in game's
`gameId`, so normal shell navigation preserves a stable game context from first paint. Lobby runtime
state and `LobbyConfig` defaults are not used as shell background/theme context. Once a game registry
or renderer shell module is imported, shell-level UI automatically inherits the game's token override
CSS, because the override is a side-effect import loaded at game registry initialisation time
(§4.35):

```typescript
// games/<game>/styles/register-token-overrides.tsx
import './tokens-override.css'; // Re-declares --ch-* tokens for the game's visual language

// games/<game>/screens/index.tsx and renderer-owned shell loaders import the registration module.
export const gameScreenRegistry: GameScreenRegistry = { ... };
```

Because token overrides are global CSS custom properties, they cascade into _all_ descendant
elements — including shell pages mounted in the same document — once the game registry or renderer
shell module has been imported. Shell pages therefore receive game theming without any explicit
wiring.

The same cascade carries the overlay **motion** tokens (`--ch-*-anim-*`, §4.35 Motion & Animation,
invariant #109): a game may retime, disable, or reshape the shell's Modal/Drawer open-close
animations from its `tokens-override.css` alone. The engine's keyframes load globally from
`renderer/styles/animations.css` (imported by the root layout after `tokens.css`); because the game
override loads later in the cascade, an override that sets literal durations must ship its own
`@media (prefers-reduced-motion: reduce)` block.

### Scope Rules

| Page              | Receives game override?                                     |
| ----------------- | ----------------------------------------------------------- |
| `main-menu`       | Yes — when explicit URL game context is present             |
| `settings`        | Yes — when explicit URL or active lobby game context exists |
| `saves`           | Never (engine-owned, game-agnostic)                         |
| `lobby`           | Yes — when explicit launch or URL game context is present   |
| Match / GameShell | Yes — always (registry imported before scene render)        |

### Lobby Modal Surface

`renderer/app/lobby/page.tsx` is a normal shell route, but it presents its content through the
shared chrome-less `Modal` (§4.35, `size="xl"`) over the shared shell background. The route
remains `/lobby` so refresh, deep-link, E2E, and IPC bootstrap behavior stay unchanged. Closing
the dialog navigates back to `/main-menu`, preserving an explicit `?gameId=` URL context when
present. The dialog carries `aria-modal` with the Modal's real focus trap (superseding the old
no-trap rationale for omitting it).

When no session exists, the lobby dialog renders a two-tab entry surface and a footer action row:

| Tab    | Purpose                                           |
| ------ | ------------------------------------------------- |
| `Host` | Confirms hosting with the parsed `LobbyConfig`    |
| `Join` | Accepts a lobby code/address and confirms joining |

The footer is the Modal's right-aligned action row, ordered `Close`, then the active tab's
primary action (`Host Lobby` or `Join Lobby`). Host/Join are `dismiss: false` actions — a
failure keeps the form open with its error banner. Escape in entry mode closes like the `Close`
button. The heading area stays quiet: it does not render lobby config badges, connection badges,
or helper captions beneath the title.

When `lobbyStore.lobbyState` is non-null, the entry tabs disappear and the footer becomes the
Modal's `Leave Lobby` (danger, `aria-describedby` pointing at a visually-hidden consequence
warning in the body) and host-gated `Start Game` (primary) actions — both `dismiss: false`, sized
and aligned exactly like every other modal's buttons. Lobby screens (the engine default and
game-provided ones alike) render only body content — session metadata, roster, ready-state and
setup controls — never their own Leave/Start bar. Escape is consumed as a no-op during an active
session — leaving stays the explicit `Leave` action. All authoritative writes continue through
`useLobbyApi()`; the route component never writes the IPC-mirrored `lobbyStore` directly.

The settings (`/settings`, `size="lg"` + `fixedHeight` so tab switches never resize the dialog),
saves (`/saves`, `size="lg"`), and replays (`/replays`, `size="lg"`) routes present through the
same chrome-less `Modal`: title, scrolling body, and a right-aligned footer (`Reset` +
`Close` for settings — `Reset` is `dismiss: false`; a lone `Close` for the browsers). Their
delete-confirm dialogs stay nested `Modal`s — the `EscapeStack` routes Escape to the confirm
first, then the page. Escape during settings key-binding capture cancels only the capture (the
capture registers its own escape layer above the page modal).

A game may customize the in-session surface by contributing a `LobbyScreen` component
(`GameScreenRegistry.LobbyScreen`, loaded via the renderer game registry). When present, the engine
renders it with `GameLobbyScreenProps` in place of the default roster UI; the host authors host-only
**match settings** (`LobbyState.matchSettings`) via `setMatchSetting`, while each player authors only its
OWN seat's **player attributes** (`LobbyPlayerEntry.attributes`, e.g. unit colour) via
`setPlayerAttribute`. Clients see another seat's values read-only. The full data and authority contract —
including how the agreed configuration becomes `snapshot.setup` — lives in §4.37.12 below and the
[Customizable Lobby Contract](customizable-lobby-contract.md).

Lobby URLs that omit an explicit `gameId` stay on the engine-default shell background path, even
when `LobbyConfig` defaults to a known game for host/join requests. This prevents the lobby route
from importing the default game's global token overrides or remounting the shell background during
plain `/main-menu` → `/lobby` navigation. Lobby URLs that provide an explicit `themeId` without an
explicit `gameId` follow the same engine-default shell background path.

---

## 4.37.5 Game-Customizable Main Menu Definition

Games customize the top-level main menu by contributing a declarative
`GameMainMenuDefinition` through their renderer shell registration. The shared contract lives in
`shared/game-shell-contract.ts`, so `renderer/` and `games/*` can both depend on the type without
creating a renderer-to-game static import.

```typescript
export type GameMenuCommandId = string & { readonly __brand: 'GameMenuCommandId' };

export interface GameMainMenuLayout {
    readonly orientation?: 'vertical' | 'horizontal';
    readonly align?: 'center' | 'start' | 'end';
    readonly anchor?:
        | 'center'
        | 'top'
        | 'bottom'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly gap?: number;
}

export type GameMainMenuAction =
    | { readonly type: 'navigate'; readonly target: string }
    | { readonly type: 'quit' }
    | { readonly type: 'open-lobby' }
    | { readonly type: 'command'; readonly commandId: GameMenuCommandId };

export interface GameMainMenuButton {
    readonly label: string;
    readonly action: GameMainMenuAction;
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    readonly disabled?: boolean | (() => Promise<boolean>);
}

export interface GameMainMenuDefinition {
    readonly layout?: GameMainMenuLayout;
    readonly buttons: readonly GameMainMenuButton[];
}
```

### Layout Defaults

| Field         | Type                                                                                            | Default         | Renderer behavior                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orientation` | `'vertical' \| 'horizontal'`                                                                    | `'vertical'`    | Maps to `flex-direction: column` or `row`.                                                                                                                 |
| `align`       | `'center' \| 'start' \| 'end'`                                                                  | `'center'`      | Maps to `align-items: center`, `flex-start`, or `flex-end`.                                                                                                |
| `anchor`      | `'center' \| 'top' \| 'bottom' \| 'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'center'`      | `center` stays in normal flow; edge anchors position the wrapper absolutely using tokenized zero edges.                                                    |
| `offsetX`     | `number`                                                                                        | `0`             | Horizontal pixel offset applied through CSS custom properties (`--menu-offset-x`) rather than bare inline pixel transforms.                                |
| `offsetY`     | `number`                                                                                        | `0`             | Vertical pixel offset applied through CSS custom properties (`--menu-offset-y`) rather than bare inline pixel transforms.                                  |
| `gap`         | `number`                                                                                        | `--ch-space-sm` | Must resolve to a design token. The renderer accepts `0`, `4`, `8`, `16`, `24`, and `40`, mapping to `--ch-space-none/xs/sm/md/lg/xl`; other values throw. |

`layout` itself is optional. When a game provides a partial layout, omitted fields use the
defaults above. `buttons` is required and may be an empty array; an empty array renders an empty
menu.

### Button and Action Semantics

| Field / variant     | Required? | Meaning                                                                                                                                                                                                                                            |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`             | Yes       | Visible button text rendered as the children of the shared `<Button>`.                                                                                                                                                                             |
| `action.type`       | Yes       | Discriminant for the action union.                                                                                                                                                                                                                 |
| `navigate.target`   | Yes       | Internal renderer route passed to `router.push(target)`, for example `'/settings'`, `'/saves'`, or `'/game'`.                                                                                                                                      |
| `quit`              | Yes       | Calls `window.__chimera.system.quit()` through the renderer system bridge.                                                                                                                                                                         |
| `open-lobby`        | Yes       | Engine shortcut for `router.push('/lobby')`; this is the engine default Play action.                                                                                                                                                               |
| `command.commandId` | Yes       | Branded `GameMenuCommandId` resolved against the game's registered `menuCommands` registry.                                                                                                                                                        |
| `variant`           | No        | Passed to the shared `<Button>` as `primary`, `secondary`, `ghost`, or `danger`.                                                                                                                                                                   |
| `disabled`          | No        | Controls the `<Button>` disabled state. `boolean` is a static state evaluated at render time; `() => Promise<boolean>` is an async availability check the renderer awaits (e.g. "are there any replays to browse?"). Omitted means always enabled. |

When `variant` is omitted, `RenderMainMenuDefinition` assigns a renderer default: `danger` for
`quit`, `primary` for the first non-quit button, and `secondary` for all remaining buttons.

`disabled` accepts either a plain `boolean` or an async check `() => Promise<boolean>`. For the
async form, `RenderMainMenuDefinition` evaluates the check once per button (in a `useEffect` keyed
on the `buttons` array) and stores the result per index. The button renders **disabled while the
check is pending** — a fail-safe that avoids a flash of enabled→disabled — and a thrown or rejected
check is likewise treated as `true` (disabled) and logged at `warn`. Omitting `disabled` leaves the
button always enabled.

## 4.37.6 Main Menu Fallback Chain

`renderer/app/main-menu/page.tsx` resolves the active game shell from explicit URL state only:
`resolveMainMenuGameId(new URLSearchParams(window.location.search))` reads `?gameId=<id>`. This
keeps the main menu independent of an active lobby or match.

The fallback chain is intentionally shallow:

1. If `?gameId=<id>` resolves and `loadRendererGameShell(id)` succeeds, use
   `LoadedRendererGameShell.mainMenu` and `LoadedRendererGameShell.menuCommands`.
2. If the loaded shell omits `mainMenu`, `RenderMainMenuDefinition` receives `undefined` and uses
   the engine default definition.
3. If there is no `gameId`, or the shell load fails, the page also passes `undefined`, which uses
   the engine default definition.

While the URL-selected shell is unresolved or loading, the page renders only the shell container.
This prevents the engine default Play / Settings / Quit buttons from flashing before a game menu
definition resolves.

When a URL-selected game menu is loaded, `navigate` and `open-lobby` actions preserve the active
`gameId` query parameter for root-relative shell routes. This lets game-customized shell pages round
trip between `/main-menu/?gameId=<id>` and `/settings/?gameId=<id>` without requiring each game to
hardcode query strings in its declarative menu definition.

The engine default is itself a `GameMainMenuDefinition`:

```typescript
const ENGINE_DEFAULT_DEFINITION: GameMainMenuDefinition = {
    layout: { orientation: 'vertical', align: 'center', anchor: 'center' },
    buttons: [
        { label: 'Play', action: { type: 'open-lobby' }, variant: 'primary' },
        {
            label: 'Settings',
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        { label: 'Quit', action: { type: 'quit' }, variant: 'danger' },
    ],
};
```

There is no partial merge between a game definition and the engine default. A provided definition
owns its button list; only omitted field-level defaults from `GameMainMenuLayout` and
`GameMainMenuButton.variant` are applied.

## 4.37.7 Game Font Contributions

Games may contribute self-hosted font faces through `LoadedRendererGameShell.fonts`. Font
declarations are pure shared data, so game packages declare them in `games/<name>/shell/fonts.ts`
using the `GameFontFace` type from `shared/game-shell-contract.ts`; the renderer registry imports
that data while assembling the game shell bundle.

```typescript
export interface GameFontFace {
    readonly family: string;
    readonly src: string;
    readonly weight?: string;
    readonly style?: 'normal' | 'italic';
    readonly display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}
```

`src` must use the local `game-id/relative/path` asset-ref shape, for example
`<game>/fonts/MyFont-Regular.woff2`. Runtime Google Fonts URLs are forbidden. Font files are
committed only as game-owned assets:

| Purpose                 | Path example                                     |
| ----------------------- | ------------------------------------------------ |
| Game-owned source asset | `games/<game>/assets/fonts/MyFont-Regular.woff2` |

`renderer/game/GameFontLoader.ts` resolves the local `src` through the app protocol as
`chimera://renderer/game-assets/<game>/fonts/MyFont-Regular.woff2`, loads it with the browser
`FontFace` API, and adds the loaded face to `document.fonts`. The loader deduplicates by family,
source, weight, and style so repeated shell loads do not add duplicate faces.

A game's shell may provide a custom font at weights 400, 700, and 900:

```typescript
export const gameFonts: readonly GameFontFace[] = [
    { family: 'MyFont', src: '<game>/fonts/MyFont-Regular.woff2', weight: '400', display: 'swap' },
    { family: 'MyFont', src: '<game>/fonts/MyFont-Bold.woff2', weight: '700', display: 'swap' },
    { family: 'MyFont', src: '<game>/fonts/MyFont-Black.woff2', weight: '900', display: 'swap' },
];
```

Use `pnpm fetch:fonts -- --game <gameId> --url "<google-css-url>"` as a development-time helper to
download `.woff2` files from a Google Fonts CSS URL into the game asset folder. The helper prints a
`GameFontFace[]` snippet but the runtime never fetches Google-hosted CSS or font files.

`tools/validate-assets.ts` validates every game font declaration before merge: external URLs,
absolute paths, and traversal are rejected; the game-owned source file must exist; and committed
game assets under `renderer/public/assets/` are rejected.

## 4.37.8 Game Menu Command Registry

Games may route buttons to renderer-local command callbacks by declaring a `command` action and
contributing a registry through their renderer shell module. The implementation models this
`GameMenuCommand` registry as a `menuCommands` object keyed by branded `GameMenuCommandId` values:

```typescript
// games/<name>/shell/main-menu.ts
export const gameMenuCommands: Partial<Record<GameMenuCommandId, () => void>> = {
    ['game:start-tutorial' as GameMenuCommandId]: () => {
        // renderer-local command
    },
};
```

The registry is loaded by `renderer/game/rendererGameRegistry.ts` as part of
`LoadedRendererGameShell`:

```typescript
export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: React.ComponentType;
}
```

`RenderMainMenuDefinition` resolves every `command` action before producing JSX. If a button refers
to a `commandId` that is absent from `menuCommands`, or if no registry was provided, rendering
throws a descriptive error. Unknown commands therefore fail fast instead of producing an inert or
silently missing button.

## 4.37.9 Game-Customizable Shell Background Component

Games may contribute a renderer-owned React component for the shell background through
`LoadedRendererGameShell.shellBackground`. This is intentionally **not** part of
`shared/game-shell-contract.ts`: it is a renderer component slot, comparable to `GameScreenRegistry`
presentation slots, and is not serializable data.

```typescript
export interface LoadedRendererGameShell {
    readonly shellBackground?: React.ComponentType;
}
```

`renderer/components/shell/ShellBackgroundHost.tsx` is mounted once from the root renderer layout.
It renders behind route content on `/main-menu`, `/settings`, and `/lobby`, and returns `null` for
`/game` and other non-shell routes. This keeps menu/settings/lobby navigation SPA-like while
preventing menu background components from entering the match scene.

### Background Fallback Chain

1. If the current shell route has a game context and the loaded shell provides `shellBackground`,
   render that component.
2. If the loaded shell omits `shellBackground`, shell loading fails, or no game context exists,
   render the engine default solid surface using `--ch-color-surface`.
3. If the current route is not `/main-menu`, `/settings`, or `/lobby`, render no shell background.

The host passes no props to the game component. Background components that need animation, canvas,
or media own those renderer-local details internally. They must not dispatch gameplay actions or
depend on Electron/main-process APIs directly.

Shell page canvases should not paint an opaque full-viewport surface when the background is meant to
be visible. Individual panels, cards, and controls should continue to use raised surface tokens for
readability.

## 4.37.10 Game-Customizable Settings Page Definition

Games customize which settings appear on the engine-owned settings page by contributing a
declarative `GameSettingsPageDefinition` through their renderer shell registration. The shared
contract lives in `shared/game-shell-contract.ts`, so `renderer/` and `games/*` can both depend on
the type without creating a renderer-to-game static import.

The settings page remains renderer-owned. Games declare tabs, sections, fields, labels, and control
metadata; they do not contribute React components, import renderer UI primitives, or bypass the
settings IPC/store lifecycle from §4.13.

```typescript
export type EngineSettingsFieldId =
    | 'audio.masterVolume'
    | 'audio.sfxVolume'
    | 'audio.musicVolume'
    | 'audio.muted'
    | 'display.fullscreen'
    | 'display.vsync'
    | 'display.targetFps'
    | 'display.uiScale'
    | 'gameplay.language'
    | 'gameplay.autoSave'
    | 'gameplay.autoSaveIntervalTurns'
    | 'gameplay.showHints'
    | 'gameplay.showPerfHud'
    | 'controls.bindings';

export type SettingsControlDefinition =
    | { readonly type: 'slider'; readonly min: number; readonly max: number; readonly step: number }
    | { readonly type: 'toggle' }
    | {
          readonly type: 'select';
          readonly options: readonly { readonly value: string; readonly label: string }[];
      }
    | { readonly type: 'key-binding' };

export type SettingsItemDefinition =
    | { readonly kind: 'engine-field'; readonly fieldId: EngineSettingsFieldId }
    | {
          readonly kind: 'game-field';
          readonly path: string;
          readonly label: string;
          readonly control: SettingsControlDefinition;
      };

export interface SettingsSectionDefinition {
    readonly id: string;
    readonly label?: string;
    readonly items: readonly SettingsItemDefinition[];
}

export interface SettingsTabDefinition {
    readonly id: string;
    readonly label: string;
    readonly sections: readonly SettingsSectionDefinition[];
}

export interface GameSettingsPageDefinition {
    readonly tabs: readonly SettingsTabDefinition[];
}
```

### Engine Field Semantics

`EngineSettingsFieldId` values are the documented `EngineSettings` paths from §4.13. The controls
namespace exposes `controls.bindings` because key bindings are persisted as
`settings.controls.bindings` (Invariant #66); `controls.rebind` is a UI panel concept and is not a
valid engine settings path.

For `engine-field` entries, the renderer owns the label, default value, and control mapping. For
`game-field` entries, the game supplies `path`, `label`, and `control` explicitly. Game-defined
paths are still validated by `SettingsManager.registerSchema()` and must not shadow the engine
top-level namespaces from Invariant #35.

The engine field registry is exhaustive for the current `EngineSettings` interface:

| Field id                         | Label                | Control     | Default / notes                                                         |
| -------------------------------- | -------------------- | ----------- | ----------------------------------------------------------------------- |
| `audio.masterVolume`             | Master Volume        | Slider      | `1`, formatted as a percentage                                          |
| `audio.sfxVolume`                | SFX Volume           | Slider      | `1`, formatted as a percentage                                          |
| `audio.musicVolume`              | Music Volume         | Slider      | `0.8`, formatted as a percentage                                        |
| `audio.muted`                    | Muted                | Toggle      | `false`                                                                 |
| `display.fullscreen`             | Fullscreen           | Toggle      | `false`                                                                 |
| `display.vsync`                  | VSync                | Toggle      | `true`                                                                  |
| `display.targetFps`              | Target FPS           | Select      | `60`; options `30`, `60`, `120`, `0`                                    |
| `display.uiScale`                | UI Scale             | Slider      | `1`, range `0.5`-`2`, formatted as `x`                                  |
| `gameplay.language`              | Language             | Select      | `en-US`; localized language options                                     |
| `gameplay.autoSave`              | Auto Save            | Toggle      | `true`                                                                  |
| `gameplay.autoSaveIntervalTurns` | Auto Save Interval   | Slider      | `5`, range `1`-`100`, integer turns                                     |
| `gameplay.showHints`             | Show Hints           | Toggle      | `true`                                                                  |
| `gameplay.showPerfHud`           | Show Performance HUD | Toggle      | `false`                                                                 |
| `controls.bindings`              | Controls             | Key-binding | Renders the input rebinding pane (game actions only; `engine:*` hidden) |

Typed game definitions cannot reference unknown engine field ids. Defensive renderer paths that
receive an untyped or stale `engine-field` fail fast instead of silently rendering an inert control.

### Engine Default Tab Set

When no game settings definition is available, the renderer uses the engine default four-tab layout:

| Tab      | Sections | Engine fields                                                                                                            |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Audio    | Audio    | `audio.masterVolume`, `audio.sfxVolume`, `audio.musicVolume`, `audio.muted`                                              |
| Display  | Display  | `display.fullscreen`, `display.vsync`, `display.targetFps`, `display.uiScale`                                            |
| Gameplay | Gameplay | `gameplay.language`, `gameplay.autoSave`, `gameplay.autoSaveIntervalTurns`, `gameplay.showHints`, `gameplay.showPerfHud` |
| Controls | Controls | `controls.bindings`                                                                                                      |

There is no partial merge between a game settings definition and the engine default tab set. A
provided `GameSettingsPageDefinition` owns its tab list. It can include any subset of engine fields,
combine engine and game fields in the same section, add game-only tabs, or provide an empty `tabs`
array to render an empty settings surface.

### Settings Page Fallback Chain

The settings page stays engine-owned. A game-provided definition controls only the ordering and
selection of fields that the engine renderer displays. The active settings game context resolves
from explicit URL state first (`?gameId=<id>`), then from the active lobby/session game, then from
the engine default:

1. If a resolved renderer shell provides `settings`, render its tabs and sections.
2. If the loaded shell omits `settings`, use the engine default settings definition.
3. If no game context exists, or shell loading fails, use the engine default settings definition.

When settings is opened with explicit URL game context, the Close action returns to
`/main-menu/?gameId=<id>` so the corresponding game-customized main menu remains active.

### Declaring a Game Settings Page

A game declares its settings page in `games/<name>/shell/settings-page.ts` and exposes it through
the renderer game registry as `LoadedRendererGame.shell.settings`. A game's definition (e.g.
`games/<game>/shell/settings-page.ts`) might contribute five tabs: Audio, Display, Gameplay, AI,
and Controls.

```typescript
import type { GameSettingsPageDefinition } from '@chimera-engine/shared/game-shell-contract.js';

export const gameSettingsPageDefinition: GameSettingsPageDefinition = {
    tabs: [
        {
            id: 'gameplay',
            label: 'Gameplay',
            sections: [
                {
                    id: 'engine-gameplay',
                    label: 'Engine',
                    items: [{ kind: 'engine-field', fieldId: 'gameplay.showPerfHud' }],
                },
                {
                    id: 'game-gameplay',
                    label: 'Game',
                    items: [
                        {
                            kind: 'game-field',
                            path: 'showGrid',
                            label: 'Show Grid',
                            control: { type: 'toggle' },
                        },
                    ],
                },
            ],
        },
    ],
};
```

`game-field.path` is a dot-path into the resolved settings object returned by §4.13. A game that adds
root-level extension keys (`showGrid`, `animationSpeed`, `showDamageNumbers`,
`aiThinkingDelayMs`) does so because its `GameSettings` interface extends `EngineSettings` directly.
Games that nest their own settings may use paths such as `<game>.difficulty` instead.

The registry wiring keeps shell pages free of static game imports:

```typescript
export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: React.ComponentType;
}
```

## 4.37.11 Module Tree

```
shared/
└── game-shell-contract.ts     # GameMainMenuDefinition, GameSettingsPageDefinition, shell-page contracts
renderer/
├── game/
│   ├── rendererGameRegistry.ts # Dynamic game shell loading; no shell-page games/* import
│   ├── gameShellAssetSource.ts # Shared local-asset-ref resolver for shell fonts/images
│   ├── GameFontLoader.ts       # Loads shell.fonts via FontFace (§4.37.7)
│   └── GameImageWarmup.ts      # Fetches + decodes shell.preloadImages (§4.37.13)
├── shell/
│   ├── renderMainMenuDefinition.tsx # Engine renderer for GameMainMenuDefinition
│   ├── renderSettingsSectionItems.tsx # Engine renderer for SettingsSectionDefinition
│   └── resolveMainMenuGameId.ts     # URL game context resolver for main menu
├── styles/
│   └── tokens.css              # Engine default --ch-* tokens (§4.35)
├── theme/
│   ├── ThemeProvider.tsx       # Provides active shell/game theme to UI components
│   ├── default-theme.ts        # Token-referenced button palette + size map
│   ├── theme-context.ts        # React context object exported for consumers
│   ├── types.ts                # Theme and button palette contract types
│   └── useTheme.ts             # Hook: returns active theme from context
├── components/
│   ├── shell/
│   │   └── ShellBackgroundHost.tsx # Persistent shell-route background host
│   └── ui/
│       └── Button.tsx          # Shared across shell pages and match screens
└── app/
    ├── layout.tsx              # Imports tokens.css globally
    ├── main-menu/
    │   └── page.tsx            # Uses <Button variant="primary|secondary|danger" />
    ├── lobby/
    │   └── page.tsx            # Chrome-less <Modal size="xl">; entry footer via ModalAction (Close + Host/Join dismiss:false)
    ├── settings/
    │   └── page.tsx            # Chrome-less <Modal size="lg" fixedHeight>; footer Reset (danger, dismiss:false) + Close
    └── saves/
        └── page.tsx            # Chrome-less <Modal size="lg">; footer Close; nested delete-confirm Modal
games/
└── <game>/
    └── shell/
    ├── ShellBackground.tsx # Optional shellBackground component contribution
        ├── main-menu.ts        # Sample GameMainMenuDefinition + menuCommands registry
        └── settings-page.ts    # Optional GameSettingsPageDefinition contribution
```

---

## 4.37.12 Game-Customizable Lobby Screen

A game customizes the in-session lobby by contributing a `LobbyScreen` React component through the
renderer game registry (`GameScreenRegistry.LobbyScreen?: ComponentType<GameLobbyScreenProps>`), plus a
pure `GameLobbySetup` descriptor registered on the main side. The engine renders the contributed screen
inside its lobby dialog (§4.37.4) and routes edits through `useLobbyApi()` → IPC → `LobbyManager`: the
host authors match settings, while each player authors only its own seat's attributes (a joined client
forwards its own-seat intent to the host). Peers see seats they do not own read-only, and the agreed
configuration is carried into the match as `snapshot.setup`, projected to every peer verbatim.

The full data and authority contract — `GameLobbySetup` / `GameSetupConfig` / `GameLobbyScreenProps`, the
lobby write path (host-authored match settings, owner-authored per-player attributes), the snapshot-setup
projection, the registry composition points, and the Tactics adopter — lives in the
**[Customizable Lobby Contract](customizable-lobby-contract.md)**. It ratifies invariants #99
(host-authored match settings / owner-authored player attributes), #100 (no direct privileged writes from
a game lobby screen), and #101 (`snapshot.setup` is public, projected verbatim).

---

## 4.37.13 Game Image Preloading

Large images paint progressively while their bytes stream in and their bitmap decodes — visible
"tearing" scanline slices. A `<link rel="preload">` only moves the _fetch_ earlier; it cannot move
the _decode_, so oversized artwork tears no matter how early it is requested. The engine closes the
gap with two cooperating pieces; use them together for any shell picture (main-menu heroes,
backgrounds, thumbnails).

### `LoadedRendererGameShell.preloadImages` — game-declared warm-up

Games declare shell images to warm through `LoadedRendererGameShell.preloadImages`, the image twin
of `fonts` (§4.37.7). Sources use the same local `game-id/relative/path` asset-ref shape; absolute
paths, protocol-relative URLs, and URL schemes are rejected (shared resolver:
`renderer/game/gameShellAssetSource.ts`).

```typescript
export const gameShell: LoadedRendererGameShell = {
    mainMenu,
    preloadImages: ['<game>/images/menu-hero.png', '<game>/images/menu-backdrop.png'],
};
```

`renderer/game/GameImageWarmup.ts` resolves each ref through the app protocol
(`chimera://renderer/game-assets/<game>/images/menu-hero.png`), fetches it via an off-screen
`Image`, and awaits `img.decode()` — the registry (`loadRendererGame` / `loadRendererGameShell`)
awaits the warm-up alongside `loadGameFonts`, so every declared picture is fetched **and fully
decoded** before the shell resolves. The loader deduplicates by resolved URL across shell loads.
Warm-up is best-effort: a broken ref logs a warning, is dropped from the warmed set (so a later
load retries), and never blocks the shell.

Declare only images the shell shows soon after load — the registry awaits the warm-up, so an
oversized list delays the first shell screen.

### `PreloadedImage` — decode-gated rendering (§4.35 UI primitive)

`PreloadedImage` (`renderer/components/ui/PreloadedImage.tsx`, exported through the
`@chimera-engine/renderer/components/ui` barrel per invariant #96) wraps `next/image` and holds the
img at `opacity: 0` until `img.decode()` settles, so the compositor's first paint of the picture is
the complete bitmap — it can never tear, even on a cold cache. It defaults to `priority` (eager
fetch; on statically exported pages Next emits the matching `<link rel="preload">` in `<head>`).
The gate fails open: a rejected decode (broken asset) reveals the img so the failure surfaces
visibly, and environments without `img.decode()` reveal immediately. The caller's `style` is
preserved, including a custom `opacity`, once revealed. The engine boot-smoke page (`/`) renders
its logo through this component.

### Sizing discipline

Neither piece fixes an oversized source: keep shipped shell images near their display size
(≈2× for retina). The engine logo budget is locked by `tools/logo-asset-budget.test.ts`
(≤512 px, ≤400 KB for a 256 px display slot); follow the same ratio for game artwork.

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #34  | `SettingsManager.registerSchema()` must be called for a game before `getSettings()` or `updateSettings()` is called. Calling `getSettings` for an unregistered `gameId` returns only engine defaults and logs a warning; a settings page definition selects presentation fields only.                                                                                                                                               |
| #35  | Game-defined settings keys must not shadow the engine top-level namespaces (`audio`, `display`, `gameplay`, `controls`). `game-field.path` entries must be backed by the registered game settings schema; presentation metadata never admits unregistered settings keys.                                                                                                                                                            |
| #36  | Settings remain outside simulation state and the `ActionPipeline`. The settings page edits values through the renderer settings store and `window.__chimera.settings`; any game parameter that affects simulation outcomes belongs in match config transmitted during lobby setup.                                                                                                                                                  |
| #80  | `GameShell.tsx` must never import from any `games/*` path. The `GameScreenRegistry` passed as a prop is the sole coupling point between the engine renderer and a game's React code. Shell-page customization follows the same registry-indirection principle through renderer registry loaders.                                                                                                                                    |
| #85  | Game token override files may only redefine tokens declared in `renderer/styles/tokens.css`. Introducing new `--ch-*` custom property names in a game's override file is a module-boundary violation.                                                                                                                                                                                                                               |
| #91  | Shell page components (`main-menu`, `lobby`, `settings`, `saves`, `component-gallery`) must not set hardcoded colour, spacing, or radius values in any inline `style` prop. All values must use `var(--ch-*)`.                                                                                                                                                                                                                      |
| #92  | Shell pages must use `<Button>` from `renderer/components/ui/Button.tsx` for all interactive actions. Raw `<button>` elements with inline styles are prohibited.                                                                                                                                                                                                                                                                    |
| #93  | Game token overrides must not be imported directly by shell page components. They enter the cascade only as side-effects of game registry initialisation (§4.35, §4.36).                                                                                                                                                                                                                                                            |
| #94  | Shell pages (`main-menu`, `settings`, `saves`, `component-gallery`) must not import from any `games/*` path. The lobby page may import `LobbyConfig` helpers but not game-specific screen modules.                                                                                                                                                                                                                                  |
| #96  | Game renderer surfaces may import UI primitives only through the public `@chimera-engine/renderer/components/ui` barrel; shell pages continue to receive game customization through renderer registry indirection.                                                                                                                                                                                                                  |
| #99  | Lobby match settings are host-authored; per-player attributes are owner-authored. `LobbyManager.setMatchSetting()` rejects a non-hosted session; `setPlayerAttribute()` rejects any seat but the caller's own and (for a joined client) forwards the own-seat intent to the host, which applies it to the connection-derived sender seat. The two IPC channels are the sole write path; changes broadcast to every peer. (§4.37.12) |
| #100 | Game `LobbyScreen` components perform no privileged writes directly — they call the engine-provided `setMatchSetting` / `setPlayerAttribute` props (routed renderer API → IPC → `LobbyManager`) and never write `lobbyStore`, call `LobbyManager`, or open IPC channels themselves. (§4.37.12)                                                                                                                                      |
| #101 | `GameSnapshot.setup` / `PlayerSnapshot.setup` is public host config passed through `StateProjector.project()` verbatim — no owner-only or per-viewer fields — so every viewer's projected snapshot carries an identical `setup`. (§4.37.12)                                                                                                                                                                                         |
| #109 | Engine UI motion (Modal/Drawer open-close, button press) is parameterised exclusively by `--ch-*` motion tokens backed by global `ch-*` keyframes in `renderer/styles/animations.css`; games customise it only through token overrides, and all engine motion collapses to instant under `prefers-reduced-motion`. (§4.35 Motion & Animation)                                                                                       |

---

## Cross-References

- [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) — §4.35 token catalogue, §4.36 game screen code splitting
- [Settings System](settings-system.md) — §4.13 settings schema, merge, repository, and IPC lifecycle
- [Renderer State Stores](renderer-state-stores.md) — store catalogue, `lobbyConfig`, `useLobbyApi()`
- [Scene Transitions & Fade](scene-transitions-fade.md) — `TransitionOverlay`, `useFade()`
- [Customizable Lobby Contract](customizable-lobby-contract.md) — §4.37.12 game-customizable lobby screen, host-authored match config, `snapshot.setup` projection
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #34–#36, #80, #85, #91–#94, #99–#101, #109
- [M8 Hardening Roadmap](../roadmap-sections/m8-hardening-v0.8.0.md) — F51 game-customizable main menu, F52 game-customizable settings page, F53 customizable lobby
