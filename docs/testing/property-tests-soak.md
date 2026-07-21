---
title: 'Testing Strategy — Unit, Integration & Property Tests'
description: 'Vitest/RTL/@react-three/test-renderer/fast-check toolchain, file conventions, vitest.config.ts, package.json scripts, test utilities, example unit tests (ActionPipeline, gameStore), property-based projection test, CI pipeline, and §10.1 full test scenario matrix.'
tags: [testing, vitest, unit-tests, property-tests, fast-check, react-testing-library, ci]
---

# Testing Strategy — Unit, Integration & Property Tests

> §10 of the Chimera architecture.
> Related: [E2E Testing (Playwright)](e2e-testing-playwright.md) · [Simulation Core](../core-components/simulation-core-action-pipeline.md) · [State Projection](../core-components/state-projection-interfaces.md)

---

## §10.0 Unit Testing Framework

### Toolchain

| Tool                         | Role                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| **Vitest**                   | Unit and integration tests for all TypeScript packages                                  |
| **React Testing Library**    | Component tests for React components and Zustand stores                                 |
| `@react-three/test-renderer` | R3F scene tests (headless Three.js, no WebGL)                                           |
| **Playwright**               | E2E tests only — real Electron instances (see [E2E Testing](e2e-testing-playwright.md)) |
| **fast-check**               | Property-based tests for projection, commitment, and determinism invariants             |

Vitest is chosen over Jest because:

- Native ESM support without transform overhead (entire codebase is ESM TypeScript)
- Vite config reuse (renderer already uses Vite; test config shares aliases, env, plugins)
- First-class `jsdom`/`happy-dom` environments per test file via `// @vitest-environment jsdom`
- Vitest UI mode gives a browser-based watch dashboard with per-file results and inline diffs

---

### File Conventions

Unit tests co-located with source, as sibling `.test.ts` / `.test.tsx` or in `__tests__/`:

```
simulation/engine/
├── ActionPipeline.ts
├── ActionPipeline.test.ts              ← unit tests
└── __tests__/
    └── ActionPipeline.pipeline.test.ts ← longer integration-style test group

simulation/__tests__/     ← cross-module integration tests
ai/__tests__/
networking/__tests__/
renderer/__tests__/

apps/tactics/e2e/         ← E2E fixtures and specs — never imported from unit tests
```

---

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node', // default: pure Node
        environmentMatchGlobs: [
            ['renderer/**/*.test.tsx', 'jsdom'],
            ['renderer/**/*.test.ts', 'jsdom'],
        ],
        coverage: {
            provider: 'v8',
            include: [
                'simulation/**/*.ts',
                'ai/**/*.ts',
                'networking/**/*.ts',
                'renderer/**/*.{ts,tsx}',
                'shared/**/*.ts',
            ],
            exclude: ['**/*.test.*', '**/__tests__/**', '**/index.ts'],
            thresholds: { lines: 80, functions: 80, branches: 75 },
        },
    },
});
```

---

### `package.json` Scripts

```json
{
    "scripts": {
        "test": "vitest run",
        "test:watch": "vitest",
        "test:ui": "vitest --ui",
        "test:coverage": "vitest run --coverage",
        "test:e2e": "CHIMERA_E2E=1 playwright test"
    }
}
```

`test` runs all unit + integration tests — fast, no Electron launch. `test:e2e` is always separate and gated by `CHIMERA_E2E=1`.

---

### Test Utilities and Shared Fixtures

```typescript
// simulation/__tests__/helpers/snapshots.ts

export function makeBaseSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 12345,
        phase: 'playing',
        players: [{ id: 'p1' as PlayerId }, { id: 'p2' as PlayerId }],
        activePlayerId: 'p1' as PlayerId,
        events: [],
        ...overrides,
    };
}
```

---

### Writing a Unit Test — Simulation Layer

```typescript
// simulation/engine/ActionPipeline.test.ts
describe('ActionPipeline', () => {
    it('advances tick by 1 on a valid action', () => {
        const registry = makeRegistryWithNoOp();
        const pipeline = createActionPipeline(registry, createInMemoryPipelineContext());
        const next = pipeline.process(
            makeBaseSnapshot({ tick: 5 }),
            { type: 'test:noop', playerId: 'p1', payload: {} },
            'p1',
        );
        expect(next.tick).toBe(6);
    });

    it('does not mutate the input snapshot', () => {
        const initial = Object.freeze(makeBaseSnapshot({ tick: 0 }));
        pipeline.process(initial, { type: 'test:noop', playerId: 'p1', payload: {} }, 'p1');
        expect(initial.tick).toBe(0);
    });
});
```

---

### Writing a Unit Test — Renderer/Zustand Store

```typescript
// @vitest-environment jsdom
describe('SnapshotStore', () => {
    it('initialises with null snapshot', () => {
        const store = createGameStore();
        expect(store.getState().snapshot).toBeNull();
    });
});
```

---

### Writing a Property Test — Projection Invariants

```typescript
// simulation/projection/StateProjector.test.ts
describe('StateProjector — no information leak', () => {
    it('never exposes owner-only hand field to a non-owner', () => {
        fc.assert(
            fc.property(arbitraryGameSnapshot(), (snapshot) => {
                const projected = projector.project(snapshot, 'p2' as PlayerId);
                const p1Hand = (projected as any).players?.p1?.hand;
                return p1Hand === undefined;
            }),
            { numRuns: 10_000 },
        );
    });
});
```

---

### CI Pipeline

```
Unit tests (vitest run)
  └── simulation/   — pure Node
  └── ai/           — pure Node
  └── networking/   — Node + in-process ws server
  └── renderer/     — jsdom
  └── tools/        — Node

Coverage gate (vitest --coverage)
  └── fails PR if lines < 80%, functions < 80%, branches < 75%

Lint gates (parallel)
  └── no-restricted-globals: blocks Math.random/Date.now in simulation/ + games/*/actions/
  └── no-restricted-imports: blocks simulation/ from importing renderer/ or games/
  └── no-snapshot-floats: flags number fields in snapshot interfaces

E2E (playwright — separate job, gated on unit test pass)
  └── CHIMERA_E2E=1 playwright test
  └── Trace + video retained on failure
```

---

## §10.1 Test Scenarios by Layer

| Layer                                | Approach                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DeterministicRng`                   | Same `(seed, tick)` → identical sequence on macOS/Windows/Linux. Fisher-Yates permutation-correct. `pick()` uniformity within 0.5% over 10⁶ draws.                                                                                                                                                                 |
| Determinism soak                     | Run 10 000-action pseudo-random match on two separate processes; assert identical `snapshot.tick` checksums at every step.                                                                                                                                                                                         |
| `ActionHistory` pruning              | 1000 entries across 5 turn mementos; `sinceLastMemento()` bounded; `pruneTo(N)` drops exactly expected range.                                                                                                                                                                                                      |
| `ActionPipeline`                     | Feed `(state, action, ctx)` triples, assert output state + events.                                                                                                                                                                                                                                                 |
| `UndoManager`                        | Apply N actions, undo M steps, assert state = replay from memento through first N-M. Verify redo, redo-stack cleared on new action.                                                                                                                                                                                |
| `ContentLoader`                      | Valid directory, conflict detection (`ContentConflictError`), schema error (`ContentSchemaError`), bad ref (`MalformedRefError`).                                                                                                                                                                                  |
| `ContentDatabase`                    | `resolveRef()` reaches correct item; `getByIdOrThrow()` throws on missing; `getAllIds()` stable ordering.                                                                                                                                                                                                          |
| `StateProjector`                     | Property: no `owner-only` / `hidden` field in non-owner `PlayerSnapshot` across 10k random snapshots (`StateProjector.property.test.ts`; F48 bullet 2).                                                                                                                                                            |
| `CommitmentScheme`                   | Valid reveal passes; tampered value throws; tampered nonce throws (`CommitmentScheme.test.ts`; F48 bullet 3 anti-tamper).                                                                                                                                                                                          |
| Networking integration               | In-process ws server + two clients. Snapshot delivery, delta correctness, reconnect.                                                                                                                                                                                                                               |
| Renderer components                  | React Testing Library + mocked `window.__chimera`.                                                                                                                                                                                                                                                                 |
| R3F scenes                           | Visual regression snapshots + pointer event dispatch via `@react-three/test-renderer`.                                                                                                                                                                                                                             |
| `AssetManager`                       | `preloadCritical()` resolves after all entries; `get()` returns null before load; `dispose()` runs without throw.                                                                                                                                                                                                  |
| `AssetResolver`                      | Dev resolver builds correct `file://` URL; prod resolver correct `resources/` path; malformed `AssetRef` throws.                                                                                                                                                                                                   |
| Asset CI validation                  | `tools/validate-assets.ts`: all `AssetRef` strings in `games/*/data/` verified against disk.                                                                                                                                                                                                                       |
| `useAsset` hook                      | Fallback while loading; re-render after resolve; no setState on unmounted.                                                                                                                                                                                                                                         |
| `SaveMigrator`                       | v0 → v1 migration; no-op at current version; `SaveSchemaTooNewError` on future version.                                                                                                                                                                                                                            |
| `JsonSaveSerializer`                 | Round-trip `serialize → deserialize` = structurally equal. Compressed variant = smaller bytes.                                                                                                                                                                                                                     |
| `FileSaveRepository`                 | Integration (temp dir): save/list/load/delete; crash-safe write; empty dir returns `[]`.                                                                                                                                                                                                                           |
| Save/load E2E                        | Playwright: save → close → relaunch → load → assert tick + player state match.                                                                                                                                                                                                                                     |
| `SnapshotRingBuffer`                 | 250 entries into capacity-200 buffer; last 200 retrievable; `onRecord` callback fires.                                                                                                                                                                                                                             |
| `SnapshotInspector`                  | In-buffer snapshot returned directly; outside-buffer reconstructed via memento+replay; `diff()` entries correct.                                                                                                                                                                                                   |
| `SnapshotDiff`                       | Identical → empty; added entity → one `added` entry; changed HP → one `changed` entry with before/after.                                                                                                                                                                                                           |
| `debug-bridge` security              | IPC handler rejects `GET_SNAPSHOT` from non-Inspector `webContents.id`.                                                                                                                                                                                                                                            |
| Debug disabled in production         | `IS_DEBUG_MODE === false`; `window.__chimeraDebug` absent in game renderer.                                                                                                                                                                                                                                        |
| `SettingsMerger`                     | `mergeAll(gameDefaults, {})` unchanged; deep partial merge; unknown keys stripped; nested merge correct.                                                                                                                                                                                                           |
| `FileSettingsRepository`             | Integration: save/load/reset; crash-safe write; invalid game-id characters throws at `filePath()`.                                                                                                                                                                                                                 |
| `SettingsManager` IPC                | `getSettings` returns engine+game defaults on empty disk; valid patch persists; invalid field → `SettingsValidationError`; reset → game defaults.                                                                                                                                                                  |
| Settings E2E                         | Playwright: change `masterVolume` → relaunch → persists; reset → game defaults.                                                                                                                                                                                                                                    |
| Settings schema migration            | Field absent from current schema → stripped at merge; remaining fields resolve correctly.                                                                                                                                                                                                                          |
| `MultiplayerProvider` contract       | `hostLobby()` returns `HostedSession` with non-empty `lobbyCode`; `joinLobby()` receives `WELCOME`; `close()` triggers `onPlayerLeft` for all clients.                                                                                                                                                             |
| `LocalWebSocketProvider` integration | Host + client on localhost; `onPlayerJoined` fires; snapshot delivery; disconnect fires `onPlayerLeft`.                                                                                                                                                                                                            |
| `InMemorySaveRepository`             | Identical contract test suite as `FileSaveRepository`.                                                                                                                                                                                                                                                             |
| Provider swap smoke test             | Replace `LocalWebSocketProvider` with `InMemoryMultiplayerProvider`; full match flow without simulation changes.                                                                                                                                                                                                   |
| Multiplayer soak                     | 1000 ticks × 4 clients, in-process host fan-out (`electron/main/__tests__/multiplayer-soak.integration.test.ts`; F48 bullet 1). Per-step convergence: two same-seed runs yield byte-identical per-viewer checksum sequences at every step. (E2E `multiplayer-soak.spec.ts` keeps a 2-process real-Electron smoke.) |
| Obfuscation soak                     | 1000 ticks × 4 clients; `assertNoLeakedFields` on every delivered `PlayerSnapshot` — no `owner-only`/`hidden` field reaches a non-owner (`multiplayer-soak.integration.test.ts`). Complements the 10k random-snapshot `StateProjector` property above.                                                             |
| `CommandScheduler`                   | Enqueue 3 commands; `onStart` fires in order; failure clears queue and calls `onFail`.                                                                                                                                                                                                                             |
| `AIStateMachine`                     | Two states; transition calls `onExit`/`onEnter`; deferred transition completes at tick end.                                                                                                                                                                                                                        |
| AI integration                       | Full match with 2 AI agents reaches terminal state; all AI actions through `ActionPipeline`.                                                                                                                                                                                                                       |
| Honest AI isolation                  | `project()`'s output never contains opponent `owner-only` fields, and every honest-AI delivery path uses it — the `AgentManager` fan-out and the construction-time seed alike (Invariant #17).                                                                                                                     |

---

## Cross-References

- [E2E Testing (Playwright)](e2e-testing-playwright.md) — Playwright specs, fixtures, page objects
- [Simulation Core](../core-components/simulation-core-action-pipeline.md) — `ActionPipeline` determinism (invariants #42–44)
- [State Projection](../core-components/state-projection-interfaces.md) — `StateProjector`, property test targets
- [Fixed-Point Math](../core-components/fixed-point-math.md) — golden-vector determinism test
