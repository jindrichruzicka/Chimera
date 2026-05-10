---
title: 'MatchShell, GameScreenRegistry, Renderer Contexts & UI Design System'
description: 'GameScreenRegistry interface (board required; hud/screens/transitionOverlay optional), MatchShell.tsx rendering contract, within-scene screen navigation (useActiveScreen/useNavigateToScreen), Renderer Context Map (AssetManagerContext/ContentDatabaseContext/AudioManagerContext/DeviceInfoContext/FadeContext), null-bang prohibition, UI design token system (--ch-* tokens), component categories, game token overrides, and code splitting (registry-level dynamic import + screen-level React.lazy).'
tags: [renderer, react, game-screen-registry, contexts, design-tokens, code-splitting, matchshell]
---

# MatchShell, GameScreenRegistry, Renderer Contexts & UI Design System

> §4.33–§4.36 of the Chimera architecture.
> Related: [Renderer State Stores](renderer-state-stores.md) · [Scene Transitions & Fade](scene-transitions-fade.md) · [Asset Reference System](asset-reference-system.md) · [Performance HUD & Device Info](performance-hud-device-info.md)

---

## 4.33 Game Screen Registry

### Overview

`MatchShell.tsx` renders the match experience without knowing which game it is rendering. The contract between a game and the engine is `GameScreenRegistry`: a typed object mapping slot names to React component types.

### GameScreenRegistry Interface

```typescript
// renderer/components/shell/MatchShell.tsx (exported for game packages to satisfy)

export interface GameScreenRegistry {
    readonly board: React.ComponentType; // Required — primary gameplay view
    readonly hud?: React.ComponentType<GameHudProps>; // Optional game-defined match HUD
    readonly screens?: Readonly<Record<string, React.ComponentType>>; // Named full-screen panels
    readonly transitionOverlay?: React.ComponentType; // Optional; engine default used when absent
    readonly matchResultBanner?: React.ComponentType<MatchResultBannerProps>; // Optional winner display
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

export interface MatchResultBannerProps {
    readonly matchResult: MatchResult;
    readonly localPlayerId?: PlayerId;
}
```

### Game Registration Pattern

```typescript
// games/tactics/screens/index.ts
const BoardScreen = React.lazy(() => import('./BoardScreen'));
const TacticsMatchHud = React.lazy(() => import('./TacticsMatchHud'));
const TechTreeScreen = React.lazy(() => import('./TechTreeScreen'));
const DiplomacyScreen = React.lazy(() => import('./DiplomacyScreen'));
const UnitDetailScreen = React.lazy(() => import('./UnitDetailScreen'));
const MatchResultBanner = React.lazy(() => import('./MatchResultBanner'));

export const MatchScreenRegistry: GameScreenRegistry = {
    board: BoardScreen,
    hud: TacticsMatchHud,
    matchResultBanner: MatchResultBanner,
    screens: {
        'tech-tree': TechTreeScreen,
        diplomacy: DiplomacyScreen,
        'unit-detail': UnitDetailScreen,
    },
};
```

### MatchShell Resolution

```typescript
// renderer/app/match/page.tsx
async function loadRegistry(gameId: string): Promise<GameScreenRegistry> {
    switch (gameId) {
        case 'tactics':
            return (await import('../../games/tactics/screens/index')).MatchScreenRegistry;
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

### MatchShell Rendering Contract

```typescript
interface MatchShellProps {
    registry: GameScreenRegistry;
}

/**
 * Responsibilities:
 *   1. Mount active screen from registry (driven by useActiveScreen)
 *   2. Build engine-owned HUD props and render registry.hud when present
 *   3. Render engine chrome: SeatSwitcher, PerfHud, ChatPanel, ToastHost
 *   4. Pass all engine contexts down the tree (§4.34)
 *   5. Gate screen components behind React.Suspense
 *   6. Delegate scene transitions to SceneRouter (§4.18)
 *   7. Delegate resolved match-result presentation to registry.matchResultBanner when present
 */
export function MatchShell({ registry }: MatchShellProps): JSX.Element;
```

`registry.hud` is a presentation override only. `MatchShell` derives the common engine control
surface (`tick`, undo/redo/end-turn disabled states, and guarded handlers) from the projected
`PlayerSnapshot` plus injected action callbacks. Game HUD components should render those props and
call `handleUndo`, `handleRedo`, and `handleEndTurn`; they should not construct `engine:undo`,
`engine:redo`, or `engine:end_turn` actions themselves. If a game omits `hud`, `MatchShell` renders
the engine fallback HUD with the stable `hud-tick`, `undo`, `redo`, and `end-turn` test IDs.

Game-provided HUDs that replace the fallback should preserve those test IDs for the equivalent
controls when the E2E page object needs to drive the match generically.

When `PlayerSnapshot.matchResult` is non-null, `MatchShell` renders `registry.matchResultBanner`
with `{ matchResult, localPlayerId }`. If the game omits the slot, `MatchShell` uses the engine
fallback text (`You won`, `You lose`, or `Draw`). Game-provided result banners should expose
`data-testid="match-result-banner"` on the banner root and `data-testid="match-result-text"` on the
primary message to keep Playwright page objects stable across games.

### Invariants

| #   | Rule                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #80 | `MatchShell.tsx` must never import from any `games/*` path. `GameScreenRegistry` is the sole coupling point.                                                     |
| #81 | `GameScreenRegistry.board` is the only required slot. A game providing only `board` is fully valid.                                                              |
| #82 | Within-scene panel navigation (`useNavigateToScreen`) is renderer-local state. It must never trigger an IPC call, advance `tick`, or dispatch an `EngineAction`. |

---

## 4.34 Renderer Contexts — Core Service Injection

### Context Map

| Context                  | Value type        | Hook                   | Source                              | Cleared on  |
| ------------------------ | ----------------- | ---------------------- | ----------------------------------- | ----------- |
| `AssetManagerContext`    | `AssetManager`    | `useAssetManager()`    | Created at match start; see §4.10   | session end |
| `ContentDatabaseContext` | `ContentDatabase` | `useContentDatabase()` | Loaded at game init; see §4.8       | session end |
| `AudioManagerContext`    | `AudioManager`    | `useAudioManager()`    | Created at match start; see §4.25   | session end |
| `DeviceInfoContext`      | `DeviceInfo`      | `useDeviceInfo()`      | Polled from main process; see §4.17 | —           |
| `FadeContext`            | `FadeControl`     | `useFade()`            | `TransitionOverlay`; see §4.19      | —           |

### Context Declarations

```typescript
// Pattern: createContext<T | null>(null) + throwing hook — mandatory for all contexts

export const AssetManagerContext = createContext<AssetManager | null>(null);
export function useAssetManager(): AssetManager {
    const ctx = useContext(AssetManagerContext);
    if (!ctx) throw new Error('useAssetManager() must be used inside <MatchShell>.');
    return ctx;
}
// Same pattern for ContentDatabaseContext, AudioManagerContext
```

### Provider Wiring in MatchShell

```typescript
export function MatchShell({ registry }: MatchShellProps): JSX.Element {
    const assetManager    = useMatchAssetManager();
    const contentDatabase = useMatchContentDatabase();
    const audioManager    = useMatchAudioManager();

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

| Category       | Examples                                    |
| -------------- | ------------------------------------------- |
| **Actions**    | `Button`, `IconButton`, `ToggleButton`      |
| **Overlays**   | `Modal`, `Drawer`, `Tooltip`, `Popover`     |
| **Containers** | `Panel`, `Card`, `Divider`, `ScrollArea`    |
| **Forms**      | `Slider`, `Toggle`, `Select`, `NumberInput` |
| **Feedback**   | `ProgressBar`, `Spinner`, `Badge`           |
| **Typography** | `Heading`, `Label`, `Caption`               |

All components are **unstyled except for CSS tokens**. No hardcoded hex values.

### Design Token Naming: `--ch-<category>-<variant>`

```css
/* renderer/styles/tokens.css — engine defaults */

/* ── Colour ─────────────────────────────────────────────── */
--ch-color-surface: #1a1a2e;
--ch-color-surface-raised: #16213e;
--ch-color-surface-overlay: #0f3460;
--ch-color-accent: #e94560;
--ch-color-accent-hover: #ff6b81;
--ch-color-text-primary: #eaeaea;
--ch-color-text-secondary: #a0a0b0;
--ch-color-text-disabled: #555577;
--ch-color-border: #2a2a4a;
--ch-color-success: #4caf50;
--ch-color-warning: #ff9800;
--ch-color-error: #f44336;

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
--ch-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
--ch-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.6);
--ch-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.8);

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

| Boundary                         | Mechanism          | When loaded                                    |
| -------------------------------- | ------------------ | ---------------------------------------------- |
| **Game registry module**         | Dynamic `import()` | When match page mounts; after game ID is known |
| **Individual screen components** | `React.lazy()`     | On first render of that screen                 |

### Registry-Level Split

```typescript
// renderer/app/match/page.tsx
async function loadRegistry(gameId: string): Promise<GameScreenRegistry> {
    switch (gameId) {
        case 'tactics':
            return (await import('../../games/tactics/screens/index')).MatchScreenRegistry;
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
// renderer/components/shell/MatchShell.tsx
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
| #88 | `MatchShell` wraps every active screen in `<React.Suspense>`. No game screen may assume it renders without a Suspense ancestor.                       |

---

## Cross-References

- [Scene Transitions & Fade](scene-transitions-fade.md) — `SceneRouter`, `TransitionOverlay`, `useFade()` / `FadeContext`
- [Asset Reference System](asset-reference-system.md) — `AssetManagerContext`, `useAsset()`
- [Content Database & DataRefs](content-database-data-refs.md) — `ContentDatabaseContext`, `useContentDatabase()`
- [Audio System](audio-system.md) — `AudioManagerContext`, `useAudioManager()`
- [Performance HUD & Device Info](performance-hud-device-info.md) — `DeviceInfoContext`, `useDeviceInfo()`
- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 shell page token contract, `Button` variant guide, game override cascade, invariants #91–94
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #80–94
