---
title: 'Renderer Shell Pages UI Contract'
description: 'Token-based styling contract for engine shell pages (main-menu, lobby, settings, saves). Defines which pages are shell-owned vs. game-owned, how the shared Button component is consumed, how GameMainMenuDefinition customizes the main menu, when game token overrides apply, and the invariants that prohibit inline styles on shell pages.'
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
        game-shell-contract,
    ]
---

# Renderer Shell Pages UI Contract

> §4.37 of the Chimera architecture.
> Related: [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) · [Renderer State Stores](renderer-state-stores.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md)

---

## Overview

§4.35 defines the engine design-token system and `renderer/components/ui/` component library for
content that renders _inside_ `GameShell`. This section documents the same contract for
**engine shell pages** — top-level Next.js pages that exist outside of any game match:

| Page path                         | Purpose                                                             | Game-owned?                     |
| --------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| `renderer/app/main-menu/`         | Title screen, entry point                                           | Engine-owned; game-customizable |
| `renderer/app/lobby/`             | Host/join/leave multiplayer lobby                                   | Partly\*                        |
| `renderer/app/settings/`          | Engine + game settings UI                                           | No                              |
| `renderer/app/saves/`             | Save-slot browser                                                   | No                              |
| `renderer/app/(loading)/`         | Transition placeholder between scenes                               | No                              |
| `renderer/app/component-gallery/` | Design-system gallery (dev/E2E only); gated by `isGalleryEnabled()` | No                              |

\* The lobby page loads game-specific configuration from `LobbyConfig` but its chrome (buttons,
layout, player list) is engine-owned. Game token overrides **are** applied to the lobby page once
a `gameId` is resolved (see §4.37.4).

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
the renderer game registry. For the main menu, this context is explicit URL state such as
`/main-menu/?gameId=tactics`; it does not require a lobby to exist. For the lobby page, context is
resolved from `LobbyConfig.gameId`. Once a game registry module is imported, the lobby page and any
subsequent shell-level UI automatically inherit the game's token override CSS, because the override
is a side-effect import loaded at game registry initialisation time (§4.35):

```typescript
// games/tactics/screens/index.ts
import './styles/tokens-override.css'; // Re-declares --ch-* tokens for Tactics visual language
export const TacticsGameScreenRegistry: GameScreenRegistry = { ... };
```

Because token overrides are global CSS custom properties, they cascade into _all_ descendant
elements — including shell pages mounted in the same document — once the game registry module
has been imported. Shell pages therefore receive game theming without any explicit wiring.

### Scope Rules

| Page              | Receives game override?                                   |
| ----------------- | --------------------------------------------------------- |
| `main-menu`       | Yes — when explicit URL game context is present           |
| `settings`        | Never (engine-owned, game-agnostic)                       |
| `saves`           | Never (engine-owned, game-agnostic)                       |
| `lobby`           | Yes — after `gameId` is resolved and registry is imported |
| Match / GameShell | Yes — always (registry imported before scene render)      |

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

| Field / variant     | Required? | Meaning                                                                                                       |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `label`             | Yes       | Visible button text rendered as the children of the shared `<Button>`.                                        |
| `action.type`       | Yes       | Discriminant for the action union.                                                                            |
| `navigate.target`   | Yes       | Internal renderer route passed to `router.push(target)`, for example `'/settings'`, `'/saves'`, or `'/game'`. |
| `quit`              | Yes       | Calls `window.__chimera.system.quit()` through the renderer system bridge.                                    |
| `open-lobby`        | Yes       | Engine shortcut for `router.push('/lobby')`; this is the engine default Play action.                          |
| `command.commandId` | Yes       | Branded `GameMenuCommandId` resolved against the game's registered `menuCommands` registry.                   |
| `variant`           | No        | Passed to the shared `<Button>` as `primary`, `secondary`, `ghost`, or `danger`.                              |

When `variant` is omitted, `RenderMainMenuDefinition` assigns a renderer default: `danger` for
`quit`, `primary` for the first non-quit button, and `secondary` for all remaining buttons.

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

## 4.37.7 Game Menu Command Registry

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
}
```

`RenderMainMenuDefinition` resolves every `command` action before producing JSX. If a button refers
to a `commandId` that is absent from `menuCommands`, or if no registry was provided, rendering
throws a descriptive error. Unknown commands therefore fail fast instead of producing an inert or
silently missing button.

## 4.37.8 Game-Customizable Settings Page Definition

Games customize which settings appear on the engine-owned settings page by contributing a
declarative `GameSettingsPageDefinition` through their renderer shell registration. The shared
contract lives in `shared/game-shell-contract.ts`, so `renderer/` and `games/*` can both depend on
the type without creating a renderer-to-game static import.

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

### Settings Page Fallback Chain

The settings page stays engine-owned. A game-provided definition controls only the ordering and
selection of fields that the engine renderer displays:

1. If a resolved renderer shell provides `settings`, render its tabs and sections.
2. If the loaded shell omits `settings`, use the engine default settings definition.
3. If no game context exists, or shell loading fails, use the engine default settings definition.

The engine default definition contains the engine tabs Audio, Display, Gameplay, and Controls.
`tabs` may be an empty array; an empty array renders an empty settings surface for that game.

## 4.37.9 Module Tree

```
shared/
└── game-shell-contract.ts     # GameMainMenuDefinition, GameSettingsPageDefinition, shell-page contracts
renderer/
├── game/
│   └── rendererGameRegistry.ts # Dynamic game shell loading; no shell-page games/* import
├── shell/
│   ├── renderMainMenuDefinition.tsx # Engine renderer for GameMainMenuDefinition
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
│   └── ui/
│       └── Button.tsx          # Shared across shell pages and match screens
└── app/
    ├── layout.tsx              # Imports tokens.css globally
    ├── main-menu/
    │   └── page.tsx            # Uses <Button variant="primary|secondary|danger" />
    ├── lobby/
    │   └── page.tsx            # Uses <Button variant="primary|secondary|danger" />
    ├── settings/
    │   └── page.tsx            # Uses <Button variant="secondary|ghost" />
    └── saves/
        └── page.tsx            # Uses <Button variant="primary|ghost|danger" />
games/
└── tactics/
    └── shell/
        ├── main-menu.ts        # Sample GameMainMenuDefinition + menuCommands registry
        └── settings-page.ts    # Optional GameSettingsPageDefinition contribution
```

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #80 | `GameShell.tsx` must never import from any `games/*` path. The `GameScreenRegistry` passed as a prop is the sole coupling point between the engine renderer and a game's React code. Shell-page customization follows the same registry-indirection principle through renderer registry loaders. |
| #85 | Game token override files may only redefine tokens declared in `renderer/styles/tokens.css`. Introducing new `--ch-*` custom property names in a game's override file is a module-boundary violation.                                                                                            |
| #91 | Shell page components (`main-menu`, `lobby`, `settings`, `saves`, `component-gallery`) must not set hardcoded colour, spacing, or radius values in any inline `style` prop. All values must use `var(--ch-*)`.                                                                                   |
| #92 | Shell pages must use `<Button>` from `renderer/components/ui/Button.tsx` for all interactive actions. Raw `<button>` elements with inline styles are prohibited.                                                                                                                                 |
| #93 | Game token overrides must not be imported directly by shell page components. They enter the cascade only as side-effects of game registry initialisation (§4.35, §4.36).                                                                                                                         |
| #94 | Shell pages (`main-menu`, `settings`, `saves`, `component-gallery`) must not import from any `games/*` path. The lobby page may import `LobbyConfig` helpers but not game-specific screen modules.                                                                                               |

---

## Cross-References

- [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) — §4.35 token catalogue, §4.36 game screen code splitting
- [Renderer State Stores](renderer-state-stores.md) — store catalogue, `lobbyConfig`, `useLobbyApi()`
- [Scene Transitions & Fade](scene-transitions-fade.md) — `TransitionOverlay`, `useFade()`
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #80, #85, #91–#94
- [M8 Hardening Roadmap](../roadmap-sections/m8-hardening-v1.0.0.md) — F51 game-customizable main menu scope
