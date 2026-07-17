---
title: 'Settings System'
description: 'EngineSettings interface, GameSettingsSchema<T>, SettingsMerger 3-layer merge, FileSettingsRepository atomic write, SettingsManager lifecycle, settingsStore, and all settings invariants.'
tags: [settings, configuration, layered-merge, repository, electron]
---

# Settings System

> §4.13 of the Chimera architecture.
> Related: [Electron Shell](electron-shell-ipc-bridge.md) · [Renderer State Stores](renderer-state-stores.md) · [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) · [Input/Keybindings](input-keybindings.md)

---

## Design Patterns

| Pattern                                | Where used                                      | Why                                                          |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| **Schema-per-game** (Zod)              | `games/<name>/settings-schema.ts`               | Compile-time type safety; runtime parse + strip unknowns     |
| **Layered defaults / Prototype merge** | `SettingsMerger.mergeAll()`                     | Engine → game → user; each layer only overrides what it sets |
| **Repository**                         | `SettingsRepository` + `FileSettingsRepository` | Mirrors `SaveRepository`; atomic write; swappable for tests  |

---

## EngineSettings — Base Interface

```typescript
// simulation/settings/SettingsSchema.ts

interface EngineSettings {
    audio: {
        masterVolume: number; // 0.0–1.0
        sfxVolume: number;
        musicVolume: number;
        muted: boolean;
    };
    display: {
        // Caps the renderer frame rate; 0 = uncapped (native refresh). Applied
        // by the renderer FrameRateLimiter (r3f barrel), never read by the
        // simulation. Games always run fullscreen in packaged builds, so there
        // is no fullscreen/vsync/uiScale setting.
        targetFps: 30 | 60 | 120 | 0;
    };
    gameplay: {
        language: string; // BCP 47 locale
        autoSave: boolean;
        autoSaveIntervalTurns: number;
        showHints: boolean;
        showPerfHud: boolean; // Forces PerfHud; overrides F3 toggle
    };
    controls: {
        /** Key bindings keyed by namespaced InputActionId (e.g. 'engine:undo').
         *  Invariant #66: stored here, never in profile data. */
        bindings: Readonly<
            Record<
                string,
                {
                    readonly primary: string;
                    readonly secondary?: string;
                    readonly modifiers?: readonly ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[];
                }
            >
        >;
    };
}
```

> **Invariant #35** — Game-defined settings keys must not shadow the four top-level engine namespace keys (`audio`, `display`, `gameplay`, `controls`). `registerSchema()` throws `SettingsNamespaceCollisionError` if violated. `GameSettingsPageDefinition` `game-field.path` entries must be backed by the registered game settings schema.
> **Invariant #36** — Settings are never read by the simulation core. Game parameters that affect simulation outcomes must be declared as match config, transmitted during lobby setup.

---

## GameSettingsSchema — Game Extension

```typescript
// Generic extension contract
interface GameSettingsSchema<TGameSettings> {
    readonly gameId: string;
    readonly defaults: TGameSettings;
    readonly schema: ZodSchema<TGameSettings>; // for parse + runtime validation
}

// Example: a game extends EngineSettings with game-specific renderer preferences
interface GameSettings extends EngineSettings {
    showGrid: boolean;
    animationSpeed: 'slow' | 'normal' | 'fast' | 'instant';
    showDamageNumbers: boolean;
    aiThinkingDelayMs: number;
}
```

---

## SettingsMerger — 3-Layer Merge

```typescript
// simulation/settings/SettingsMerger.ts

type UserSettings = DeepPartial<EngineSettings & TGameSettings>;
type ResolvedSettings = Readonly<EngineSettings & TGameSettings>;

interface SettingsMerger {
    // Layer 1: engine defaults (hard-coded in EngineSettings)
    // Layer 2: game defaults (from GameSettingsSchema.defaults)
    // Layer 3: user overrides (from SettingsRepository)
    mergeAll(
        engineDefaults: EngineSettings,
        gameDefaults: TGameSettings,
        userOverrides: UserSettings,
    ): ResolvedSettings;
}
```

---

## SettingsRepository — Repository Pattern

```typescript
// simulation/settings/SettingsRepository.ts

interface SettingsRepository {
    load(gameId: string): Promise<UserSettings>; // returns empty object if no file
    save(gameId: string, settings: UserSettings): Promise<void>; // atomic .tmp rename
    reset(gameId: string): Promise<void>; // delete user overrides file
}
```

`FileSettingsRepository` stores settings at `userData/settings/<gameId>.json`. Sanitises `gameId` to a safe filesystem filename (alphanumeric + hyphens only) before constructing the path.

> **Invariant #32** — Settings are never stored inside `GameSnapshot`, `SaveFile`, or `PlayerSnapshot`.
> **Invariant #33** — `FileSettingsRepository.save()` always writes `.tmp` then renames atomically.

---

## SettingsManager

```typescript
// electron/main/settings-manager.ts

interface SettingsManager {
    // Must be called before getSettings() / updateSettings() for a game
    registerSchema<T>(schema: GameSettingsSchema<T>): void;

    // Returns ResolvedSettings (engine + game + user merged)
    getSettings(gameId?: string): Promise<ResolvedSettings>;

    // Deep-merges patch into user overrides; saves; broadcasts onChange
    updateSettings(patch: Partial<UserSettings>, gameId?: string): Promise<void>;

    // Deletes user overrides; reverts to engine + game defaults
    resetSettings(gameId?: string): Promise<void>;
}
```

> **Invariant #34** — `registerSchema()` must be called for a game before `getSettings()` or `updateSettings()`. Calling for an unregistered `gameId` returns only engine defaults and logs a warning (no throw — graceful degradation).

---

## Settings Lifecycle Sequence

```
App Start
  1. SettingsManager.registerSchema(engineSchema)            ← always first
  2. SettingsManager.registerSchema(gameSchema)              ← per game at init
  3. SettingsManager.getSettings('<game>')
       → SettingsRepository.load('<game>')                  ← reads userData/settings/<game>.json
       → SettingsMerger.mergeAll(engineDef, gameDef, userOverrides)
       → returns ResolvedSettings

User Changes Volume
  1. Renderer: window.__chimera.settings.update({ audio: { masterVolume: 0.7 } }, '<game>')
     → IPC → SettingsManager.updateSettings(patch, '<game>')
     → SettingsMerger.mergeAll(..., newOverrides)
     → SettingsRepository.save('<game>', newOverrides)   ← atomic write
     → broadcast onChange → renderer → settingsStore.applySettings(resolved)

Settings UI Reset
  1. window.__chimera.settings.reset('<game>')
     → SettingsManager.resetSettings('<game>')
     → SettingsRepository.reset('<game>')               ← deletes userData file
     → broadcast onChange → renderer with engine+game defaults
```

---

## settingsStore

```typescript
// renderer/state/settingsStore.ts (IPC mirror)
interface SettingsStore {
    settings: ResolvedSettings | null;
    applySettings(settings: ResolvedSettings): void; // called by ipcClient only
}
```

## Presentation Layer

The renderer settings page is documented in [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md). Games may contribute a declarative `GameSettingsPageDefinition` to choose which engine fields and game fields are displayed, but presentation metadata does not replace `SettingsManager.registerSchema()`, `SettingsMerger`, or the settings repository lifecycle described here.

---

## Cross-References

- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — `GameSettingsPageDefinition`, engine default settings tabs, and renderer field registry (§4.37)
- [Input/Keybindings](input-keybindings.md) — `controls.bindings` in `EngineSettings` (§4.26)
- [Audio System](audio-system.md) — `audio.*` settings drive AudioBus volumes (§4.25)
- [Performance HUD](performance-hud-device-info.md) — `gameplay.showPerfHud` forces PerfHud (§4.16)
- [Electron Shell](electron-shell-ipc-bridge.md) — `SettingsAPI` IPC namespace
