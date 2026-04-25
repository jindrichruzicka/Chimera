---
title: 'M7 — 3D Render Integration (v0.7.0)'
description: 'F35–F42, F50: R3F GameCanvas/Camera, Asset Manager/Resolver, Curves/Tweening/Interaction, UI Design System, Scene Transitions/MatchShell, Audio System, Input/Keybindings, Performance HUD, and Device Info. R3F canvas renders game entities; asset pipeline is production-ready; scene transitions work end-to-end.'
tags:
    [
        milestone,
        m7,
        r3f,
        canvas,
        camera,
        assets,
        tweening,
        audio,
        input,
        scene-transitions,
        matchshell,
        performance,
        device-info,
        ui-design-system,
    ]
---

# M7 — 3D Render Integration (v0.7.0)

> **Goal**: R3F canvas renders game entities; asset pipeline is production-ready; scene transitions work end-to-end.
> Architecture sections: §4.10, §4.16, §4.17, §4.18, §4.19, §4.21, §4.22, §4.23, §4.25, §4.26, §4.33, §4.34, §4.35, §4.36

---

## F35 — R3F GameCanvas and Camera System `§4.22`

Implement `GameCanvas` with `cameraMode` and `cameraPreset` props, built-in camera presets (isometric, top-down, side-scrolling, free), `useCamera` hook (`setPosition`, `lookAt`, `zoom`, `animateTo`), `CameraAnimationCancelled` error, and optional `cameraStore`.

---

## F36 — Asset Manager and Resolver `§4.10`

Implement `AssetResolver` (dev + production variants), `AssetManager` (`preloadCritical`, `get`, `load`, `dispose`), `AssetPreloader` (progress callback), and `useAsset<T>` hook. Wire `AssetManagerContext`. Implement `tools/validate-assets.ts` CI script.

---

## F37 — Curves, Tweening, and Interaction `§4.21, §4.23`

Implement `curves.ts` (`lerp`, `linear`, `easeIn`, `easeOut`, `easeInOut`), `useTween` hook (R3F `useFrame`-driven), `useTweenCallback` variant, `useGameInteraction` hook, and `InteractionBlocker` context provider.

---

## F50 — UI Design System `§4.35`

Implement `renderer/components/ui/` primitive library: `Button`, `Modal`, `Panel`, `Slider`, `ProgressBar`, `Spinner`, `Tooltip`, `Badge`, `Divider`, `ScrollArea`. Publish `renderer/styles/tokens.css` with the full `--ch-*` custom property token set (colours, spacing, radius, typography, shadows, motion). Enforce via lint that no engine component contains a hardcoded hex, pixel-size, or spacing literal — all values reference `var(--ch-*)` tokens. Define the game override pattern (`games/<name>/styles/tokens-override.css` as a side-effect import that only redefines existing tokens). Wire `prefers-reduced-motion` into `--ch-motion-*` tokens. Invariants #85 and #86 apply.

---

## F38 — Scene Transition System + MatchShell `§4.18, §4.19, §4.33, §4.34, §4.36`

Implement `SceneDescriptor`, `SceneRegistry`, `SceneManager` (two-phase prepare / commit protocol), reserved actions (`engine:scene_prepare`, `engine:scene_ready`, `engine:scene_commit`), `SceneRouter`, `TransitionOverlay`, and `useFadeTransition`. Add scene invariants 49–52 to validator.

Implement `GameScreenRegistry` (typed slot interface: `board` required; `hud`, `screens`, `transitionOverlay` optional) and `MatchShell.tsx` — the game-agnostic match chrome that receives a `GameScreenRegistry` prop, never imports from any `games/*` path (Invariant #48, #80). `MatchShell` assembles the full context provider tree (`AssetManagerContext`, `ContentDatabaseContext`, `AudioManagerContext`, `DeviceInfoContext`, `FadeContext`) per §4.34, wraps each screen in `<React.Suspense>` per §4.36, and wires `useActiveScreen()` / `useNavigateToScreen()` hooks backed by `uiStore.activeScreenKey`. Implement `ContentDatabaseContext` and `FadeContext`; wire the remaining contexts from F36 (`AssetManagerContext`), F39 (`AudioManagerContext`), and F42 (`DeviceInfoContext`). All screen components registered in a game's `screens/index.ts` must be wrapped in `React.lazy()` (Invariant #87, #88). Invariants #80–#88 apply.

---

## F39 — Audio System `§4.25`

Implement `AudioManager`, `AudioBus` (gain + ducking), `EventAudioBinding`, `useSound` hook, and `<EventAudioPlayer>` component. Wire volume buses to `SettingsStore.audio.*`. Implement pool (32-voice default) with priority-based preemption. Define lifecycle owner (`MatchShell`).

---

## F40 — Input and Keybindings `§4.26`

Implement `InputManager` (keyboard + gamepad), `InputAction` registry, `KeyBindingRepository`, `useInputAction` hook, conflict detection, and rebind UI in `settings/page.tsx`. Wire engine default bindings (undo, redo, end-turn, toggle-menu, toggle-perf-hud).

---

## F41 — Performance HUD `§4.16`

Implement `PerfHud`, `PerfProbe` (R3F `useFrame` GL stats), and `perfStore`. Wire FPS, frame time, sim tick, actions/sec, action round-trip, ping, heap, draw calls, and triangles. Toggle with F3 or `settings.gameplay.showPerfHud`.

---

## F42 — Device Info `§4.17`

Implement `DeviceInfo`, `device-probe.ts` (main process), `DeviceInfoProvider`, `useDeviceInfo`, `usePrimaryInput`, `useWindowSizeClass` hooks, and `inputTracker`. Add `getDeviceInfo()` and `onDeviceInfoChange()` to `SystemAPI`.

---

## Cross-References

- [Camera System](../core-components/camera-system.md)
- [Asset Reference System](../core-components/asset-reference-system.md)
- [Curves, Tweening & Interaction](../core-components/curves-tweening-interaction.md)
- [Scene Transitions & Fade](../core-components/scene-transitions-fade.md)
- [MatchShell & UI Design System](../core-components/matchshell-ui-design-system.md)
- [Audio System](../core-components/audio-system.md)
- [Input & Keybindings](../core-components/input-keybindings.md)
- [Performance HUD & Device Info](../core-components/performance-hud-device-info.md)
