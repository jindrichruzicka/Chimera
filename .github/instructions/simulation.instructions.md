---
applyTo: 'simulation/**,ai/**'
---

# Simulation & AI Layer — Rules

These rules apply to every file under `simulation/` and `ai/`. They are hard constraints; violations are **BLOCK** findings at review.

## Module Boundaries (Invariant #2)

`simulation/` and `ai/` may import from:

- `shared/`
- Each other (`ai/` may import `simulation/`)

`simulation/` and `ai/` must **NEVER** import from:

- `renderer/`
- `electron/`
- `games/*`
- Any DOM API (`window`, `document`, `navigator`, `localStorage`, etc.)
- Three.js or any graphics library

## Determinism Rules (Invariants #43, #44)

**NEVER** call any of the following inside `simulation/` or `ai/` code, especially inside `validate()` or `reduce()`:

- `Math.random()` — use `ctx.rng` from `ReduceContext` instead
- `Date.now()` — use `snapshot.tick` for simulation time instead
- `performance.now()` — same; forbidden in simulation
- `new Date()` — forbidden inside reducers

**NEVER** add float fields to `GameSnapshot` or any of its sub-objects that participate in equality checks or arithmetic. All arithmetic fields in `GameSnapshot` must be integers (Invariant #44).

## State Mutation Rules

- `validate()` and `reduce()` must be **pure functions**. They must not mutate their input `snapshot` argument.
- Mutation is only permitted on freshly-constructed objects before they are returned from `reduce()`.
- Do not use `Object.assign(existingObject, ...)` — return a new object: `{ ...existing, field: newValue }`.

## IPC Boundary (Invariant #1)

`GameSnapshot` must **never leave the main process**. Only `PlayerSnapshot` crosses IPC or WebSocket boundaries.

- Do not expose `GameSnapshot` from any function that is called on the IPC path.
- `simulation/` must not import from `electron/` — this boundary must be observed in both directions.

## TypeScript in This Layer

- `strict: true` — no `any`, no `@ts-ignore` without a `@ts-expect-error: <reason>` comment.
- `readonly` on every field of `GameSnapshot` and all sub-types.
- Generic parameters named semantically: `TState extends BaseGameSnapshot`, `TPayload`, `TParams`.
- Branded types for all string-shaped identifiers: `PlayerId`, `ActionType`, `AssetRef<T>`.

## Testing Rules

- Simulation tests require **zero mocks**. The pure reducer pattern means every test is a plain function call:

    ```typescript
    const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
    expect(next.tick).toBe(6);
    ```

- If you feel the need to mock something inside `simulation/`, that signals a hidden dependency the code must not have.
- Test doubles live in `__test-support__/` — never in the source files.

## ESLint Reminders

The following ESLint rules actively enforce the above in CI:

- `no-restricted-globals` — blocks `Math.random` / `Date.now` inside `simulation/` and `games/*/actions/`
- `no-restricted-imports` — blocks `renderer/`, `electron/`, `games/*` imports from `simulation/`
- `chimera/no-restricted-globals` — blocks `window`, `document`, `navigator` inside `simulation/` and `ai/`

Any `// eslint-disable` requires a `@chimera-review: <reason>` comment on the preceding line.
