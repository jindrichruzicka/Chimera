---
applyTo: 'simulation/**,ai/**,apps/*/simulation/**,apps/*/ai/**'
---

# Simulation & AI Layer — Rules

These rules also apply to per-game simulation code (`apps/<game>/simulation/`) and game AI
policies (`apps/<game>/ai/`) — game gameplay logic is held to the same determinism and
boundary standards as the engine packages (a game's own `simulation/` modules may additionally
import each other by relative path).

Source of truth:

- [Simulation layer standards](../../docs/coding-standards-sections/simulation-layer.md)
- [TypeScript standards](../../docs/coding-standards-sections/typescript.md)
- [Simulation action pipeline](../../docs/core-components/simulation-core-action-pipeline.md)
- [AI framework](../../docs/core-components/ai-framework-agent-system.md)
- [Fixed-point math](../../docs/core-components/fixed-point-math.md)
- [Module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md)
- [Architecture invariants](../../docs/executive-architecture/architecture-invariants.md)

Use this file only as the fast BLOCK checklist:

- `validate()` and `reduce()` are pure, deterministic, and immutable; never mutate input snapshots.
- Use `ctx.rng` and `snapshot.tick`; no `Math.random()`, wall-clock APIs, I/O, DOM, or environment reads in simulation paths.
- Store gameplay arithmetic as integers or `FixedPoint`, never floating-point `GameSnapshot` fields.
- Keep imports to `shared/`, `simulation/`, and `ai/` ownership boundaries; no renderer, Electron, game package, network, DOM, Three.js, or graphics imports.
- Route behavior through `ActionRegistry`, `ActionPipeline`, and AI `EngineAction` dispatch; no side-door mutation paths.
- Prefer `readonly`, branded IDs, and strict generics (`TState extends BaseGameSnapshot`, payload, params).
- Test reducers and pipeline behavior with direct calls and test-support doubles only; mocks inside `simulation/` signal a hidden dependency.
- Any `eslint-disable` needs a preceding `@chimera-review: <reason>`.
