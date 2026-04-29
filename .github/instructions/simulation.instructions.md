---
applyTo: 'simulation/**,ai/**'
---

# Simulation & AI Layer — Rules

Hard constraints; violations are **BLOCK**.

## Module Boundaries (Inv #2)

May import: `shared/`; each other (`ai/` may import `simulation/`).

NEVER import: `renderer/`, `electron/`, `games/*`, DOM (`window`/`document`/`navigator`/`localStorage`), Three.js or any graphics lib.

## Determinism (Inv #43, #44)

Forbidden inside `simulation/`/`ai/` (esp. `validate()`/`reduce()`):

- `Math.random()` → use `ctx.rng`
- `Date.now()` / `performance.now()` → use `snapshot.tick`
- `new Date()`

No float fields in `GameSnapshot` or sub-objects participating in equality/arithmetic — all arithmetic fields integer (Inv #44).

## State Mutation

- `validate()` and `reduce()` are **pure**; do not mutate the input `snapshot`.
- Mutate only freshly-constructed objects before returning.
- No `Object.assign(existing, …)` — return `{ ...existing, field: newValue }`.

## IPC Boundary (Inv #1)

`GameSnapshot` never leaves main. Only `PlayerSnapshot` crosses IPC/WebSocket. `simulation/` must not import from `electron/`.

## TypeScript

- `strict: true`; no `any`/`@ts-ignore` without `@ts-expect-error: <reason>`.
- `readonly` on every `GameSnapshot` field/sub-type.
- Generics: `TState extends BaseGameSnapshot`, `TPayload`, `TParams`.
- Branded IDs: `PlayerId`, `ActionType`, `AssetRef<T>`.

## Testing — Zero Mocks

Pure-reducer means every test is a direct function call:

```typescript
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
```

Need to mock inside `simulation/`? Hidden dependency — remove it. Doubles in `__test-support__/` only.

## ESLint Enforced

- `no-restricted-globals` — `Math.random`/`Date.now` in `simulation/`/`games/*/actions/`
- `no-restricted-imports` — `renderer/`/`electron/`/`games/*` from `simulation/`
- `chimera/no-restricted-globals` — `window`/`document`/`navigator` in `simulation/`/`ai/`

`// eslint-disable` requires `@chimera-review: <reason>` on the preceding line.
