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
}

export interface GameResultBannerProps {
    readonly gameResult: GameResult;
    readonly localPlayerId?: PlayerId;
}
```

### Game Registration Pattern

```typescript
// games/tactics/screens/index.ts
const BoardScreen = React.lazy(() => import('./BoardScreen'));
const TacticsGameHud = React.lazy(() => import('./TacticsGameHud'));
const TechTreeScreen = React.lazy(() => import('./TechTreeScreen'));
const DiplomacyScreen = React.lazy(() => import('./DiplomacyScreen'));
const UnitDetailScreen = React.lazy(() => import('./UnitDetailScreen'));
const GameResultBanner = React.lazy(() => import('./GameResultBanner'));

export const TacticsGameScreenRegistry: GameScreenRegistry = {
    board: BoardScreen,
    hud: TacticsGameHud,
    gameResultBanner: GameResultBanner,
    screens: {
        'tech-tree': TechTreeScreen,
        diplomacy: DiplomacyScreen,
        'unit-detail': UnitDetailScreen,
    },
};
```

### GameShell Resolution

```typescript
// renderer/app/game/page.tsx
async function loadRegistry(gameId: string): Promise<GameScreenRegistry> {
    switch (gameId) {
        case 'tactics':
            return (await import('../../games/tactics/screens/index')).TacticsGameScreenRegistry;
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
 *   3. Render engine chrome: PerfHud, ChatPanel, ToastHost
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
| **Actions**    | `Button`, `IconButton`, `ToggleButton`                   |
| **Overlays**   | `Modal`, `Drawer`, `Tooltip`, `Popover`                  |
| **Containers** | `Panel`, `Card`, `Divider`, `ScrollArea`, `Tabs`         |
| **Forms**      | `Slider`, `Toggle`, `TextInput`, `Select`, `NumberInput` |
| **Feedback**   | `ProgressBar`, `Spinner`, `Badge`                        |
| **Typography** | `Heading`, `Label`, `Caption`                            |

All components are **unstyled except for CSS tokens**. No hardcoded hex values.

### Component Gallery (`/component-gallery/`)

`renderer/app/component-gallery/` is a **development and E2E-only** visual fixture for the §4.35 primitive library. It is gated by `isGalleryEnabled()` (active in any non-production `NODE_ENV` — i.e. `development`, `test`, or any value other than `production` — and when `NEXT_PUBLIC_CHIMERA_E2E=1` regardless of environment) and is not part of the production navigation tree.

The gallery covers all six §4.35 primitive categories — **Actions**, **Overlays**, **Containers**, **Forms**, **Feedback**, and **Typography** — each rendered as a named section. The top-level category navigation is implemented with `Tabs` (from the Containers category), making the gallery the primary live demonstration of that component.

Boundary rules (invariants [#93](../executive-architecture/architecture-invariants.md) and [#94](../executive-architecture/architecture-invariants.md)): the gallery must not import from any `games/*` path, and must not directly import game token override CSS — overrides enter the cascade only as side-effects of game registry initialisation (§4.36).

### Design Token Naming: `--ch-<category>-<variant>`

```css
/* renderer/styles/tokens.css — engine defaults */

/* ── Colour ─────────────────────────────────────────────── */
--ch-color-surface: #111113;
--ch-color-surface-raised: #1b1b1f;
--ch-color-surface-overlay: #27272a;
--ch-color-accent: #3f3f46;
--ch-color-accent-hover: #52525b;
--ch-color-text-primary: #f4f4f5;
--ch-color-text-secondary: #a1a1aa;
--ch-color-text-disabled: #71717a;
--ch-color-border: #3f3f46;
--ch-color-success: #16a34a;
--ch-color-warning: #d97706;
--ch-color-error: #dc2626;

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

/* ── Typography ──────────────────────────────────────────── */
--ch-font-ui: 'Inter', system-ui, sans-serif;
--ch-font-game: 'Cinzel', serif;
--ch-font-mono: 'JetBrains Mono', monospace;
--ch-font-size-sm: 12px;
--ch-font-size-md: 14px;
--ch-font-size-lg: 18px;
--ch-font-size-xl: 24px;

/* ── Shadows ─────────────────────────────────────────────── */
--ch-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.28);
--ch-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.36);
--ch-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.44);

/* ── Button Shape & Elevation ────────────────────────────── */
--ch-button-radius: var(--ch-radius-pill);
--ch-button-font-weight: 700;
--ch-button-font-size-sm: 1rem;
--ch-button-font-size-md: 1.125rem;
--ch-button-font-size-lg: 1.25rem;
--ch-button-line-height-sm: 1.5rem;
--ch-button-line-height-md: 1.75rem;
--ch-button-line-height-lg: 2rem;
--ch-button-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
--ch-button-shadow-hover: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
--ch-button-shadow-hover-danger: 0 25px 50px -12px rgba(220, 38, 38, 0.5);
--ch-button-transform: scale(1);
--ch-button-transform-hover: scale(1.05);
--ch-button-padding-sm: 0.375rem 1.5rem;
--ch-button-padding-md: 0.5rem 2rem;
--ch-button-padding-lg: 0.75rem 2.5rem;

/* ── Motion ──────────────────────────────────────────────── */
--ch-duration-fast: 120ms;
--ch-duration-normal: 250ms;
--ch-duration-slow: 400ms;
--ch-easing-standard: cubic-bezier(0.4, 0, 0.2, 1);
```

### Game Token Overrides

Games inject a CSS file as a side-effect import:

```css
/* games/tactics/styles/tokens-override.css */
--ch-color-surface: #0d1117;
--ch-color-accent: #58a6ff;
--ch-radius-md: 2px;
```

```typescript
// games/tactics/screens/index.ts
import './styles/tokens-override.css'; // side-effect; redefines tokens for this game
```

Games may only override tokens declared in `renderer/styles/tokens.css`. Inventing new `--ch-*` token names is prohibited (invariant #85).

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

| #   | Rule                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #85 | Game token override files may only redefine tokens in `renderer/styles/tokens.css`. Introducing new `--ch-*` names in a game override is a module-boundary violation. |
| #86 | Engine UI components must not contain hardcoded colour, spacing, or radius values. Every visual attribute references `var(--ch-*)` or a scoped CSS Module class.      |

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
        case 'tactics':
            return (await import('../../games/tactics/screens/index')).TacticsGameScreenRegistry;
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
- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 shell page token contract, `Button` variant guide, game override cascade, invariants #91–94
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #80–94
