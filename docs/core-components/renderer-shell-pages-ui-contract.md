---
title: 'Renderer Shell Pages UI Contract'
description: 'Token-based styling contract for engine shell pages (main-menu, lobby, settings, saves). Defines which pages are shell-owned vs. game-owned, how the shared Button component is consumed, when game token overrides apply, and the invariants that prohibit inline styles on shell pages.'
tags: [renderer, ui, design-tokens, shell-pages, button, theming, lobby, main-menu]
---

# Renderer Shell Pages UI Contract

> §4.37 of the Chimera architecture.
> Related: [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) · [Renderer State Stores](renderer-state-stores.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md)

---

## Overview

§4.35 defines the engine design-token system and `renderer/components/ui/` component library for
content that renders _inside_ `GameShell`. This section documents the same contract for
**engine shell pages** — top-level Next.js pages that exist outside of any game match:

| Page path                         | Purpose                                                             | Game-owned? |
| --------------------------------- | ------------------------------------------------------------------- | ----------- |
| `renderer/app/main-menu/`         | Title screen, entry point                                           | No          |
| `renderer/app/lobby/`             | Host/join/leave multiplayer lobby                                   | Partly\*    |
| `renderer/app/settings/`          | Engine + game settings UI                                           | No          |
| `renderer/app/saves/`             | Save-slot browser                                                   | No          |
| `renderer/app/(loading)/`         | Transition placeholder between scenes                               | No          |
| `renderer/app/component-gallery/` | Design-system gallery (dev/E2E only); gated by `isGalleryEnabled()` | No          |

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

When a game is in context (i.e., `LobbyConfig.gameId` is resolved), the lobby page and any
subsequent shell-level UI automatically inherit the game's token override CSS, because the
override is a side-effect import loaded at game registry initialisation time (§4.35):

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
| `main-menu`       | Never (no game loaded yet)                                |
| `settings`        | Never (engine-owned, game-agnostic)                       |
| `saves`           | Never (engine-owned, game-agnostic)                       |
| `lobby`           | Yes — after `gameId` is resolved and registry is imported |
| Match / GameShell | Yes — always (registry imported before scene render)      |

---

## 4.37.5 Module Tree

```
renderer/
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
```

---

## Invariants

| #   | Rule                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #91 | Shell page components (`main-menu`, `lobby`, `settings`, `saves`, `component-gallery`) must not set hardcoded colour, spacing, or radius values in any inline `style` prop. All values must use `var(--ch-*)`. |
| #92 | Shell pages must use `<Button>` from `renderer/components/ui/Button.tsx` for all interactive actions. Raw `<button>` elements with inline styles are prohibited.                                               |
| #93 | Game token overrides must not be imported directly by shell page components. They enter the cascade only as side-effects of game registry initialisation (§4.35, §4.36).                                       |
| #94 | Shell pages (`main-menu`, `settings`, `saves`, `component-gallery`) must not import from any `games/*` path. The lobby page may import `LobbyConfig` helpers but not game-specific screen modules.             |

---

## Cross-References

- [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) — §4.35 token catalogue, §4.36 game screen code splitting
- [Renderer State Stores](renderer-state-stores.md) — store catalogue, `lobbyConfig`, `useLobbyApi()`
- [Scene Transitions & Fade](scene-transitions-fade.md) — `TransitionOverlay`, `useFade()`
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #91–94
