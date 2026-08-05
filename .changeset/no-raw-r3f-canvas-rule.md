---
'@chimera-engine/electron': minor
---

New `chimera/no-raw-r3f-canvas` lint rule (Invariant #127): a game surface must not obtain the `Canvas` binding from `@react-three/fiber` — `GameCanvas` (`role="main" | "overlay"`) is the only canvas root a game mounts. The rule is name-based, so `useFrame`, `useThree`, and type-only imports from the same specifier stay legal; it catches the named import, the aliased form, re-exports, and namespace member access (`fiber.Canvas`, `<fiber.Canvas>`). Registered in `chimeraPlugin` and carried by `standaloneLintConfig()`, so scaffolded games get it on the whole app like the renderer-barrel boundary rule.
