# Chimera Engine — Coding Standards

> Authoritative reference for all contributors and automated agents.  
> These rules are enforced at review time. Violations block merge.  
> Where a rule references the architecture document, `docs/architecture-overview.md` is always the primary source.

---

## Table of Contents

1. [TypeScript](#1-typescript)
2. [SOLID Principles](#2-solid-principles)
3. [Module Boundaries](#3-module-boundaries)
4. [File and Symbol Naming](#4-file-and-symbol-naming)
5. [React and Zustand](#5-react-and-zustand)
6. [React Three Fiber (R3F)](#6-react-three-fiber-r3f)
7. [Simulation Layer](#7-simulation-layer)
8. [Electron / IPC](#8-electron--ipc)
9. [Networking](#9-networking)
10. [Error Handling](#10-error-handling)
11. [Security](#11-security)
12. [Testing](#12-testing)
13. [Performance](#13-performance)
14. [Git and Commit Discipline](#14-git-and-commit-discipline)
15. [Toolchain Reference](#15-toolchain-reference)

---

## 1. TypeScript

### 1.1 Compiler settings

- `strict: true` is mandatory in every `tsconfig.json`. No exceptions.
- `noUncheckedIndexedAccess: true` — all array/record indexing returns `T | undefined`.
- `exactOptionalPropertyTypes: true` — `undefined` is not assignable to an optional field unless `?` is declared.
- Path aliases use the `@chimera/*` namespace (e.g. `@chimera/simulation/engine`). Never use relative `../../..` paths across package boundaries.

### 1.2 Forbidden patterns

| Pattern | Why forbidden | Allowed alternative |
|---------|---------------|---------------------|
| `any` (explicit or inferred) | Destroys type safety end-to-end | Use `unknown` and narrow at runtime |
| `@ts-ignore` | Silently hides errors | Fix the type; if impossible add `@ts-expect-error` with a mandatory comment |
| `@ts-expect-error` without comment | Hides the rationale | `// @ts-expect-error: <reason why this specific cast is safe>` |
| `as unknown as X` without comment | Unsafe double-cast | Fix the type; if bridging generated code, comment with `@chimera-review: <reason>` |
| `Object.assign(existingObject, ...)` in simulation | Mutates state | Return a new object: `{ ...existing, field: newValue }` |
| `Math.random()` anywhere in `simulation/` or `games/*/actions/` | Breaks determinism | Use `ctx.rng` from `ReduceContext` |
| `Date.now()` / `performance.now()` in `simulation/` | Breaks determinism | Use `snapshot.tick` for all simulation time |

### 1.3 Data types

- Prefer `readonly` on every field of data types. Mutation is only permitted inside `reduce()`, and only on freshly-constructed objects before they are returned.
- Use **discriminated unions** over class hierarchies for data: `type Result = { ok: true; value: T } | { ok: false; error: E }`.
- Use **branded / phantom types** to prevent string-shaped identifiers from mixing: `type PlayerId = string & { readonly __brand: 'PlayerId' }`.
- Do not use numeric enums. Use `as const` string unions or string literal types.
- Generic type parameters must be named semantically: `TState`, `TParams`, `TPayload`, `TSnapshot`. Single-letter names (`T`, `U`) are only acceptable in trivial one-line utility types.

### 1.4 Functions and exports

- All public function return types are **explicitly annotated**. No inferred `any` may escape a function boundary.
- Use `satisfies` for configuration objects to catch shape errors without widening.
- Use `as const` for static lookup tables.
- Prefer `function` syntax over arrow functions at module scope for named exports — easier to read in stack traces.
- Factory functions are preferred over constructors for complex objects requiring dependency injection.

### 1.5 Imports

- Use named imports. Avoid `import * as X` unless consuming a module with no named exports.
- Sort imports: external packages → `@chimera/*` path aliases → relative paths. Within each group, alphabetical order.
- Never import a type with a value import when only the type is needed. Use `import type { Foo }`.

### 1.6 Formatting and indentation

- **Indentation is four spaces.** No tabs, no two-space indentation. This applies uniformly to all TypeScript, JavaScript, JSON, JSX/TSX, and Markdown files in the repository. YAML keeps its ecosystem-standard two-space indentation (enforced by a Prettier override).
- Continuation lines and JSX attribute wraps also indent by four spaces per level.
- The formatter and editor baseline are the source of truth: [`.editorconfig`](../.editorconfig) and [`.prettierrc.json`](../.prettierrc.json) at the repository root. Do not override them per-file.
- Run `pnpm format` before committing; CI runs `pnpm format:check` and fails on diffs.
- Mixed indentation in a single file is a **BLOCK** finding at review.

---

## 2. SOLID Principles

### SRP — Single Responsibility

Every module, class, and function has exactly one reason to change.

- Orchestrators (e.g. `SimulationHost`, `LobbyManager`) **wire collaborators**; they contain no domain logic.
- Domain logic lives in focused collaborators injected at the wiring point.
- A function longer than ~40 lines is a smell — split at conceptual boundaries, not arbitrary line counts.

### OCP — Open / Closed

Engine core is **closed to modification**. All new behaviour is added by extension:

- New game actions → register an `ActionDefinition`. Never edit `ActionPipeline.ts`.
- New save formats → implement `SaveSerializer`. Never edit `SaveManager.ts`.
- New multiplayer backends → implement `MultiplayerProvider`. Never edit `LobbyManager.ts`.

### LSP — Liskov Substitution

Every implementation of an interface must honour the **full documented contract**:

- Return types must match exactly — no widened or narrowed shapes.
- Error types thrown must match those documented for the interface.
- Lifecycle invariants must be upheld (e.g. `onEnter` fires before any `onTick`; `setInitialState` triggers `onEnter`).
- Substituting one implementation for another must be **invisible** to callers.

### ISP — Interface Segregation

Pass the narrowest interface a collaborator needs:

- Never pass a 7-field aggregate when 2 fields suffice.
- Prefer role interfaces: `ReduceContext`, `HistoryContext`, `BroadcastContext` over a single fat `PipelineContext` passed everywhere.
- IPC handlers accept only the fields they actually read, not the entire `ipcMain.event` object.

### DIP — Dependency Inversion

High-level modules depend on abstractions; concrete classes are wired at one site only:

- `electron/main/index.ts` is the **sole wiring point** for all injected dependencies.
- `simulation/` and `ai/` never reference any concrete repository, provider, or platform class.
- Any new high-level module that references a `new ConcreteClass()` inside itself is a violation.

---

## 3. Module Boundaries

These boundaries are hard constraints. Violations are **BLOCK** findings at review.

| Package | May import from | Must NOT import from |
|---------|----------------|----------------------|
| `simulation/` | `shared/` | `renderer/`, `electron/`, `games/*`, any DOM API |
| `ai/` | `simulation/`, `shared/` | `renderer/`, `electron/`, `games/*`, any DOM API |
| `renderer/` | `simulation/content` (types only), `shared/`, `renderer/` internals | `electron/main/`, `ai/engine/` (except IPC types), `games/*/data` |
| `games/<name>/` | `simulation/`, `ai/`, `shared/`, own files | Other `games/` directories |
| `electron/main/` | All packages | DOM APIs |
| `networking/provider/local/` | Only within `local/` | Engine or renderer internals |

**ESLint enforcement**

- `no-restricted-globals` — blocks `Math.random` / `Date.now` inside `simulation/` and `games/*/actions/`.
- `no-restricted-imports` — blocks `simulation/` from importing `renderer/` or `games/`.
- `chimera/no-fromfloat-in-simulation` — blocks `FixedPoint.fromFloat()` inside hot simulation paths.
- `chimera/no-restricted-globals` — blocks `window`, `document`, `navigator` inside `simulation/` and `ai/`.

Any `// eslint-disable` bypass requires a `@chimera-review: <reason>` comment on the preceding line. CI greps for unaccompanied disables and fails the build.

---

## 4. File and Symbol Naming

### 4.1 File naming

| Convention | When to use | Example |
|------------|-------------|---------|
| **PascalCase** | Exports a class or interface with the same name | `ActionPipeline.ts`, `SaveFile.ts` |
| **camelCase** | Exports a Zustand store, React hook, or renderer utility | `gameStore.ts`, `useAsset.ts` |
| **kebab-case** | Node.js-style module with no single dominant export (Electron main, tooling, fixtures) | `lobby-manager.ts`, `check-and-merge.sh` |

Test files mirror their source: `ActionPipeline.test.ts` alongside `ActionPipeline.ts`.

### 4.2 Symbol naming

- **Interfaces** and **types**: `PascalCase` matching the architecture document exactly.
- **Enums / const unions**: `PascalCase` for the type; `SCREAMING_SNAKE` for individual members only if they are truly constant identifiers (e.g. error codes). Prefer string literal unions over enums.
- **React components**: `PascalCase`.
- **Hooks**: `useCamelCase`.
- **IPC channels**: `chimera:<domain>:<verb>` — all lowercase kebab. Example: `chimera:game:send-action`.
- **Zustand store methods**: `camelCase` verbs — `applySnapshot`, `setLobbyState`, `clearPredictions`.
- **Action types**: `<namespace>:<verb_noun>` — all lowercase with underscores for space. Example: `tactics:move_unit`, `engine:end_turn`.

---

## 5. React and Zustand

### 5.1 Component purity

- Components are **pure** with respect to game state. They never hold game logic.
- A component that does more than read state and dispatch user intent has too many responsibilities.

### 5.2 Zustand store subscriptions

```typescript
// ✅ Narrow selector — component only re-renders when tick changes
const tick = useGameStore(s => s.snapshot?.tick);

// ❌ BLOCK — subscribes to the whole store; re-renders on every state change
const state = useGameStore();
```

### 5.3 Dispatching actions

```typescript
// ✅ Via typed hook
const sendAction = useSendAction();
sendAction({ type: 'tactics:move_unit', payload: { unitId, to } });

// ❌ BLOCK — direct call from component
window.__chimera.game.sendAction({ type: 'tactics:move_unit', payload: { ... } });
```

### 5.4 Derived state

```typescript
// ✅ Derive in selector
const canUndo = useGameStore(s => s.snapshot?.undoMeta.canUndo ?? false);

// ❌ WARNING — useEffect for state derivation
useEffect(() => {
  setCanUndo(snapshot?.undoMeta.canUndo ?? false);
}, [snapshot]);
```

### 5.5 Store mutation ownership

- Store mutation methods marked `// ipcClient only` must never be called from a component. They are called exclusively by `ipcClient` when a new `PlayerSnapshot` arrives from main process.

### 5.6 `useEffect` usage

- `useEffect` is for **side effects** (subscriptions, focus management, analytics events) — not state derivation.
- Every `useEffect` must have a complete dependency array. Exhaustiveness is enforced by `eslint-plugin-react-hooks`.
- Cleanup functions must be provided for every subscription or timer registered in `useEffect`.

---

## 6. React Three Fiber (R3F)

### 6.1 Data passed to R3F components

- Pass only the fields a component renders. Never pass a full `PlayerSnapshot` to a component that uses three fields.
- Use typed selectors from the Zustand game store to extract the exact slice needed.

### 6.2 Assets

```typescript
// ✅ Correct — check the loading flag
const { asset, loading } = useAsset<THREE.Texture>(ref);
if (loading) return <Fallback />;

// ❌ WARNING — checking the type of a fallback value
if (asset instanceof THREE.Texture) { ... }
```

- `AssetRef<T>` strings always come from content data. Never construct them as string literals in component code.
- Do not create geometries or materials inside a component's render path. Hoist to `useMemo` or module scope.

### 6.3 Render loop

- Per-frame logic belongs in `useFrame`. Never use `setInterval` or `setTimeout` to drive animation.
- Do not call `setState` inside `useFrame`. Update the ref, let the next render derive from it, or use `invalidate()` explicitly.
- The render loop and simulation tick are **decoupled**. The R3F canvas reads from the Zustand store; it never drives the simulation.

---

## 7. Simulation Layer

### 7.1 Determinism — three inviolable rules

1. **Action-driven clock only.** Time advances via `snapshot.tick`, never `Date.now()` or `performance.now()`.
2. **Seeded RNG only.** All randomness flows through `ctx.rng` (xoshiro256\*\* seeded from `(snapshot.seed, snapshot.tick)`). No `Math.random()` anywhere in `simulation/` or `games/*/actions/`.
3. **Integer arithmetic only in `GameSnapshot`.** All snapshot fields that participate in equality or arithmetic must be `bigint` (Q32.32 fixed-point via `FixedPoint`) or plain `number` integers. No `float` fields in `GameSnapshot`.

### 7.2 Reducer purity

- `validate()` and `reduce()` are **pure functions**. Same inputs → same output, always.
- They must not read environment variables, perform I/O, access the file system, or call any platform API.
- They must not mutate the input `snapshot`. Always return a new object.

### 7.3 `GameSnapshot` invariants

- `GameSnapshot` must never cross process or network boundaries. Only `PlayerSnapshot` (a projected, filtered view) is transmitted.
- No DOM imports, Three.js imports, or Node.js platform APIs inside `simulation/` or `ai/engine/`.

### 7.4 Fixed-point arithmetic

- Use `FixedPoint` (Q32.32 `bigint`) for all fractional simulation values. The `FixedPoint.fromFloat()` factory is forbidden inside `validate()`, `reduce()`, and all hot simulation paths. Use it only in content loaders for hard-coded constants.
- Prefer the named constants `FP_ZERO`, `FP_ONE`, `FP_HALF`, `FP_PI` over constructing equivalent values inline.

---

## 8. Electron / IPC

### 8.1 Security settings — non-negotiable

Every `BrowserWindow` must be created with:

```typescript
webPreferences: {
  nodeIntegration:  false,
  contextIsolation: true,
  preload: path.join(__dirname, '../preload/api.js'),
}
```

These settings are **Invariants 3 and 4** in `docs/architecture-overview.md` Appendix B. Any new `BrowserWindow` without them is a **BLOCK** finding.

### 8.2 Preload surface

- The preload script exposes only `window.__chimera` via `contextBridge.exposeInMainWorld`.
- The exposed API is typed in nine namespace files: `game-api.ts`, `lobby-api.ts`, `saves-api.ts`, `settings-api.ts`, `profile-api.ts`, `replay-api.ts`, `chat-api.ts`, `logs-api.ts`, `system-api.ts`.
- `debug-api.ts` is **not** part of `window.__chimera`. It exposes `window.__chimeraDebug` exclusively on the Inspector Window (`CHIMERA_DEBUG=1`). The game renderer window never has access to it.
- No additional globals, property extensions, or undocumented channels are permitted.

### 8.3 IPC input validation

- Every `ipcMain.handle` handler must validate its input with Zod before passing it to any domain object. Unvalidated input from the renderer is untrusted user input.
- Handlers must never return a full `GameSnapshot`. They return only `PlayerSnapshot` or purpose-built response DTOs.

### 8.4 File system

- All file writes use an atomic write pattern: write to `<target>.tmp`, then `fs.rename` to the final path. Direct writes to the final path are forbidden (crash-safe writes, Invariant 38).
- User file paths must be derived from `app.getPath('userData')` only. No user-supplied path is ever used without sanitisation.

---

## 9. Networking

### 9.1 Provider abstraction

- All multiplayer code interacts through `MultiplayerProvider`, `HostTransport`, and `ClientTransport` interfaces.
- `ws` (or any transport library) is never imported outside `networking/provider/local/`. All other modules use the provider interfaces.

### 9.2 Message validation

- Every incoming `ClientMessage` and `ServerMessage` is validated against its Zod schema before processing. Malformed messages from the wire are untrusted input.
- The checksum in `ActionEnvelope` (CRC32) is verified on receipt. Failed checksum triggers a full state resync, not a crash.

### 9.3 Snapshot distribution

- `StateBroadcaster` calls `StateProjector.project()` per player before sending. Each client receives only its own `PlayerSnapshot`.

---

## 10. Error Handling

### 10.1 Error types

- Domain errors are typed and documented in the architecture spec. Use the exact class names and shapes declared there (e.g. `UnknownActionTypeError`, `ContentConflictError`, `SaveSchemaTooNewError`).
- Do not throw plain `new Error('string')` in domain code. Create a typed error class extending `Error` with a descriptive `name` property.
- Do not use `try/catch` to swallow errors silently. Either handle and recover, or re-throw with added context.

### 10.2 Result types vs exceptions

- Use exceptions for **programmer errors** and **unrecoverable failures** (e.g. invariant violations, corrupt data, missing required config).
- Use result types (`{ ok: true; value: T } | { ok: false; error: E }`) for **expected failure paths** at domain boundaries (e.g. `validate()` returning a `ValidationResult`).

### 10.3 IPC error propagation

- IPC handler errors are caught by the preload bridge and surfaced as typed rejections to the renderer. Never let an uncaught exception crash the main process from an IPC handler.
- The renderer's `RootErrorBoundary` catches render-phase errors and renders a recovery UI.

---

## 11. Security

This section maps directly to OWASP Top 10 risks relevant to Electron desktop applications.

### 11.1 Input validation (A03 — Injection)

- **All IPC input is untrusted.** Validate with Zod before any use. This applies to `ipcMain.handle` payloads, `ws` message bodies, and any data read from `userData`.
- Never pass IPC-received data to `eval`, `Function()`, `child_process.exec`, or any shell-executing API.

### 11.2 Prototype pollution (A08 — Software and Data Integrity)

- Never spread (`...`) a `JSON.parse` result directly onto an object without schema validation.
- Use `Object.create(null)` for plain-data dictionaries that may receive user-controlled keys.

### 11.3 Path traversal (A01 — Broken Access Control)

- All file-system operations use paths derived from `app.getPath('userData')` or compile-time constants.
- Never accept a path string from IPC input or `ws` messages and pass it to `fs` APIs.

### 11.4 Snapshot leakage (A01)

- `GameSnapshot` must never appear in an IPC response, a WebSocket message, or a log line. Only `PlayerSnapshot` crosses any boundary.
- Reviewer must run `assertNoLeakedFields()` logic against the diff for any change touching IPC handlers or `StateBroadcaster`.

### 11.5 Electron node access (A05 — Security Misconfiguration)

- `nodeIntegration: false` and `contextIsolation: true` on every window — no exceptions.
- Never call `shell.openExternal()` with a URL derived from IPC input.
- Never load remote URLs in a `BrowserWindow` in production.

### 11.6 Hardcoded secrets

- No API keys, tokens, signing certificates, or passwords as string literals in source.
- Signing keys are injected via CI environment variables only.

---

## 12. Testing

### 12.1 Test-Driven Development — mandatory cycle

1. **Write failing tests first.** Create the test file, import the not-yet-existing module, write `describe`/`it` blocks, and confirm they are **red**.
2. **Write the minimum implementation** to turn each test green. No gold-plating.
3. **Refactor under green.** Clean up only once all tests pass. Re-run after every change.

Committing implementation code without a corresponding test is a workflow violation.

### 12.2 Toolchain

| Tool | Purpose |
|------|---------|
| **Vitest** | Unit and integration tests for all TypeScript packages |
| **React Testing Library** | Component and store tests in `jsdom` |
| `@react-three/test-renderer` | R3F scene tests (no WebGL required) |
| **fast-check** | Property-based tests for projection, determinism, and commitment invariants |
| **Playwright** | End-to-end tests only — real Electron instances, `CHIMERA_E2E=1` flag |

### 12.3 File conventions

- Unit tests: `<Module>.test.ts` / `<Module>.test.tsx` co-located with the source file.
- Integration tests spanning multiple modules: `<package>/__tests__/<name>.test.ts`.
- Test doubles (fakes, stubs): `<package>/__test-support__/`.
- E2E fixtures and specs: `e2e/` only. Never imported from unit tests.

### 12.4 Coverage gates (CI)

| Metric | Minimum |
|--------|---------|
| Lines | 80% |
| Functions | 80% |
| Branches | 75% |

### 12.5 What to test

| New code | Required coverage |
|----------|-------------------|
| `ActionDefinition` | `validate()` rejects every illegal payload variant; `reduce()` returns exact expected state; `reduce()` does not mutate input |
| `simulation/` module | Constructor contract; happy path; every documented error type; boundary values |
| Renderer component | Loading state; resolved-data render; correct `sendAction` call on interaction |
| Zustand store | Default values; each mutation; each selector |
| IPC handler | Valid input → correct response; invalid input → rejection matches documented error type |
| Bug fix | Reproducing test written **first**, confirmed red, then fixed |

### 12.6 No mocks in simulation tests

Simulation unit tests require zero mocks. Pure reducers are plain function calls:

```typescript
const next = pipeline.process(makeBaseSnapshot({ tick: 5 }), action, 'p1');
expect(next.tick).toBe(6);
```

A felt need to mock inside `simulation/` means a hidden dependency exists that should be removed.

### 12.7 No real resources in unit tests

Unit tests must never touch the real filesystem, real network, or real Electron IPC. Use:

- `InMemorySaveRepository` instead of `FileSaveRepository`
- `InMemoryMultiplayerProvider` instead of `LocalWebSocketProvider`
- In-process builder helpers from `<package>/__test-support__/`

---

## 13. Performance

### 13.1 Simulation hot path

- No per-tick allocations that can be hoisted out of the loop. Create objects once; reuse them.
- `ActionPipeline` must complete in ≤ 16 ms at 20 Hz on the target hardware baseline.

### 13.2 IPC

- Do not send a full `GameSnapshot` (or large serialised snapshot) over IPC on every tick. Send `PlayerSnapshot` diffs where possible.
- Synchronous blocking FS operations (`fs.readFileSync`, `fs.writeFileSync`) on the main process event loop are forbidden. Use `fs.promises` or atomic rename with `writeFileSync` only on a worker thread.

### 13.3 Renderer

- R3F geometry and materials must be created inside `useMemo` or at module scope — never inside the render function.
- `useAsset` must receive a stable `AssetRef` reference (not an object literal constructed inline each render). Inline object literals break referential equality and cause redundant asset re-fetches.
- Do not subscribe to the entire Zustand store. Use narrow selectors to limit re-renders.

### 13.4 Memory baseline (production target)

| Metric | Target |
|--------|--------|
| Main process heap | ≤ 32 MB during active match |
| Renderer heap | ≤ 32 MB during active match |

---

## 14. Git and Commit Discipline

### 14.1 Branch naming

| Work type | Prefix | Example |
|-----------|--------|---------|
| Feature / task issue | `feature/` | `feature/action-pipeline-stages-12` |
| Bug fix | `fix/` | `fix/snapshot-tick-overflow-7` |
| Refactor | `refactor/` | `refactor/lobby-manager-ipc` |

Branch names are lowercase kebab-case only. When branching from a GitHub issue, the branch slug ends with `-<issue-number>`.  
Use the **git skillset → create-branch sub-skill** to create branches from issues.

### 14.2 Commit structure

- The **first commit** on a branch must have a non-empty body describing what was done and why:
  ```
  feat(simulation): decompose ActionPipeline into stage methods

  - Tests written first (red); resolve(), parse(), intercept(),
    validate(), reduce(), record(), broadcast() stage methods
    implemented to turn each test green
  - Each stage receives only the narrow context it needs
  ```
- All subsequent commits must be `fixup!` commits targeting the first:
  ```
  git commit --fixup <first-commit-sha>
  ```
- Plain free-form commit messages beyond the first are not permitted.

### 14.3 Merge policy

- Only the **git skillset → merge sub-skill** may land branches onto `main`.
- `main` is always fast-forward only. Merge commits are forbidden.
- Never `git merge main` into a topic branch. Use `git rebase origin/main`.

---

## 15. Toolchain Reference

### 15.1 Package manager

`pnpm` is the only permitted package manager. `npm install` and `yarn` must not be used. Lock file is `pnpm-lock.yaml`.

### 15.2 Common scripts

```bash
pnpm test              # vitest run — all unit and integration tests
pnpm test:watch        # vitest — interactive watch mode
pnpm test:coverage     # vitest run --coverage
pnpm test:e2e          # CHIMERA_E2E=1 playwright test
pnpm lint              # eslint with all chimera/* rules
pnpm format            # prettier --write on the tracked tree
pnpm format:check      # prettier --check — CI-gated, must pass
pnpm dev               # electron dev with hot-reload harness
pnpm dev:mp 3          # 1 host + 2 auto-joining clients (multiplayer dev)
```

### 15.3 Path aliases

All `@chimera/*` path aliases are declared in the root `tsconfig.json` and resolved by `vite-tsconfig-paths` in Vitest and the renderer's Vite config. Never add bare relative `../../` imports across package boundaries — use the alias.

### 15.4 Vitest config

```typescript
// vitest.config.ts (root)
environmentMatchGlobs: [
  ['renderer/**/*.test.tsx', 'jsdom'],
  ['renderer/**/*.test.ts',  'jsdom'],
]
// Default: 'node' — simulation and ai tests run without DOM
```

Override per file with `// @vitest-environment jsdom` when a single file in a non-renderer package needs browser APIs.

---

*Last updated: 2026-04-21. Maintained alongside `docs/architecture-overview.md`.*
