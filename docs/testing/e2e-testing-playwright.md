---
title: 'E2E Testing Layer (Playwright)'
description: 'Playwright-driven E2E suite for real Electron instances. Covers tooling rationale, directory structure, fixtures, page objects, helpers, mandatory specs including save/load, settings persistence, the __e2eHooks main-process contract, CHIMERA_E2E flag, CI YAML, and security notes.'
tags: [testing, e2e, playwright, electron, multiplayer, fixtures, page-objects, ci]
---

# E2E Testing Layer (Playwright)

> §13 of the Chimera architecture.
> Related: [Testing Strategy](property-tests-soak.md) · [Dev Tooling & Harness](../core-components/dev-tooling.md) · [Runtime Debug Layer](../core-components/runtime-debug-layer.md)

---

## §13.1 Executive Decision

All cross-process, multiplayer, and full-stack scenarios are validated through Playwright launching real Electron instances. Unit and integration tests (§10) cover individual modules in isolation; the E2E suite owns scenarios requiring IPC, WebSocket networking, state projection, and rendering to work simultaneously.

`CHIMERA_E2E=1` activates lightweight test hooks in the main process without modifying production behaviour.

---

## §13.2 Tooling Rationale

| Concern                  | Choice                                           | Reason                                                                     |
| ------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Test runner              | `@playwright/test`                               | First-class Electron API (`_electron`), fixture model, trace/video capture |
| Electron launch          | `playwright._electron.launch()`                  | Control over `args`, `env`, main-process evaluation                        |
| Multi-window multiplayer | Two `ElectronApplication` fixtures per test      | Each is a fully isolated OS process                                        |
| IPC inspection           | `electronApp.evaluate()` in main-process context | Access internal state without changing IPC surface                         |
| WebSocket tapping        | Node.js interceptor injected via `CHIMERA_E2E`   | Capture frames without proxy middleware                                    |
| Assertions               | Custom typed helpers + standard `expect`         | `PlayerSnapshot` shape is too opaque for generic matchers                  |

---

## §13.3 Directory Structure

```
apps/tactics/e2e/
├── playwright.config.ts
├── *.test.ts                    # Vitest shape-checks (playwright.config, global-setup,
│                                #   electron/game/lobby fixtures) — validate exports and
│                                #   config values without launching Electron (deliberate)
├── global-setup.ts
├── tsconfig.json                # Restores @chimera-engine/* path resolution for the runner
├── fixtures/
│   ├── electron.fixture.ts      # Base: launch / close one ElectronApplication
│   ├── direct-game.fixture.ts   # Host/client direct-game boot helpers
│   ├── lobby.fixture.ts         # Extends base: two instances + lobby helpers
│   ├── game.fixture.ts          # Extends lobby: game started, tick driver wired
│   └── inherit-env.ts           # Sanitised env passthrough for launched apps
├── pages/                       # POMs; co-located *.test.ts locator-wiring and
│   │                            #   *.testid-alignment.test.ts renderer-testid guards where present
│   ├── MainMenuPage.ts
│   ├── LobbyPage.ts             # POM: host/join/ready/start/leave/close
│   ├── TacticsLobbyPage.ts      # extends LobbyPage: AI seats, colors, commitment toggle
│   ├── GamePage.ts              # POM: HUD, canvas moves, undo/redo, game-over, HUD save
│   ├── InGameMenuPage.ts        # POM: Escape menu, confirm-leave
│   ├── SavesPage.ts             # POM: saves screen rows, load, delete dialog
│   ├── ReplayPlayerPage.ts
│   ├── ChatPanelPage.ts
│   ├── ComponentGalleryPage.ts
│   └── SettingsPage.ts
├── helpers/
│   ├── ipc-spy.ts               # Read main-process state via electronApp.evaluate()
│   ├── ws-inspector.ts          # Tap raw WebSocket frames
│   ├── snapshot-assert.ts       # assertNoLeakedFields(), assertTickAdvanced(), assertChecksumMatch()
│   ├── tick-driver.ts           # Programmatic tick dispatch — used in soak specs
│   ├── canvas-pixels.ts         # RGBA pixel analysis helpers for 3D canvas assertions
│   ├── lobby-match.ts           # readyAndStart() multi-window match bootstrap
│   └── relaunch.ts              # Relaunch an Electron process with captured args/env
├── types/
│   └── e2e-hooks.d.ts           # __e2eHooks ambient (references electron dist types)
└── tests/
    ├── boot-smoke.spec.ts
    ├── chat.spec.ts
    ├── component-gallery.spec.ts
    ├── debug-inspector.spec.ts
    ├── end-turn.spec.ts
    ├── game-flow.spec.ts
    ├── game-navigation.spec.ts
    ├── game-result.spec.ts
    ├── in-game-menu-leave.spec.ts
    ├── input-keybindings.spec.ts
    ├── leave-to-tactics-menu.spec.ts
    ├── lobby-fixture.spec.ts
    ├── lobby-password.spec.ts
    ├── lobby.spec.ts
    ├── main-menu-custom.spec.ts
    ├── main-menu.spec.ts
    ├── multiplayer-soak.spec.ts
    ├── obfuscation.spec.ts
    ├── pass-and-play-auto-handoff.spec.ts
    ├── perf-hud.spec.ts
    ├── perf-renderer-heap.spec.ts
    ├── player-left-toast.spec.ts
    ├── presence-toast.spec.ts
    ├── reconnect.spec.ts
    ├── replay-delete.spec.ts
    ├── replay-leave-preserves-gameid.spec.ts
    ├── replay-sequential-matches.spec.ts
    ├── replay.spec.ts
    ├── save-load-ui.spec.ts     # Menu-driven save/load/delete UI flow (port 7786)
    ├── save-load.spec.ts        # IPC-driven save + relaunch menu-restore (port 7785)
    ├── scene-transition.spec.ts
    ├── settings-persistence.spec.ts
    ├── settings-tabs.spec.ts
    ├── shell-background.spec.ts
    ├── stamina-reset-new-match.spec.ts
    ├── tactics-3d-render.spec.ts
    ├── tactics-ai.spec.ts
    ├── tactics-commitment.spec.ts
    ├── tactics-lobby-color-sync.spec.ts
    ├── tactics-replay-initial-color.spec.ts
    ├── tactics-stamina-turns.spec.ts
    ├── theme.spec.ts
    └── undo-redo.spec.ts
```

> **Note — Vitest shape-check files in `apps/tactics/e2e/` root:** the root `*.test.ts` files
> (`playwright.config.test.ts`, `global-setup.test.ts`, and the `electron`/`game`/`lobby`
> fixture tests) are intentional Vitest unit tests co-located at the `apps/tactics/e2e/` root
> (§12.3 pattern). They validate module-level exports and config values without launching
> Electron, so failures surface in the fast Vitest run rather than only during a full E2E
> run. Playwright's `testDir: './tests'` correctly excludes them; they are picked up by
> Vitest's `include` glob instead.

---

## §13.4 Playwright Configuration

```typescript
// apps/tactics/e2e/playwright.config.ts
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1, // Multiplayer tests bind to fixed localhost ports — run serially
    retries: 1,
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'results/e2e.xml' }],
    ],
    use: {
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    globalSetup: './global-setup.ts', // Compile renderer bundle once before all tests
});
```

---

## §13.5 Fixtures

### Base Electron Fixture

```typescript
// apps/tactics/e2e/fixtures/electron.fixture.ts
export interface E2eElectronLaunchOptions {
    readonly port: string;
    readonly role?: 'host' | 'client';
    readonly initialRoute?: `/${string}`;
}

export const test = base.extend<ElectronFixtures>({
    electronApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7778',
            },
        });
        await use(app);
        await app.close();
    },
    mainWindow: async ({ electronApp }, use) => {
        const window = await electronApp.firstWindow();
        await window.waitForLoadState('domcontentloaded');
        await use(window);
    },
});
```

### Multiplayer Lobby Fixture

```typescript
// apps/tactics/e2e/fixtures/lobby.fixture.ts
export const test = electronTest.extend<LobbyFixtures>({
    hostApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: '7779',
            role: 'host',
            initialRoute: '/lobby',
        });
        await use(app);
        await app.close();
    },
    clientApp: async ({}, use) => {
        const app = await launchE2eElectronApplication({
            port: '7779',
            role: 'client',
            initialRoute: '/lobby',
        });
        await use(app);
        await app.close();
    },

    hostWindow: async ({ hostApp }, use) => {
        const w = await hostApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },

    clientWindow: async ({ clientApp }, use) => {
        const w = await clientApp.firstWindow();
        await w.waitForLoadState('domcontentloaded');
        await use(w);
    },
});

export { expect } from '@playwright/test';
```

`initialRoute` is an E2E-only shortcut for loading a static-export route directly.
When provided, `createE2eElectronLaunchConfig()` sets `CHIMERA_E2E_INITIAL_URL`, and
`createMainWindow()` loads that URL instead of the default launch URL. The value must be a
slash-prefixed Next.js route path; the fixture appends a trailing slash so it matches
the renderer's `trailingSlash: true` static-export output. The override is read only
when `CHIMERA_E2E=1`; production builds load the explicit game main-menu launch URL.

---

## §13.6 Page Objects

### LobbyPage

```typescript
// apps/tactics/e2e/pages/LobbyPage.ts
import { Page, Locator } from '@playwright/test';

export class LobbyPage {
    readonly hostButton: Locator;
    readonly joinButton: Locator;
    readonly readyButton: Locator;
    readonly startButton: Locator;
    readonly playerList: Locator;
    readonly sessionId: Locator;
    readonly connectionStatus: Locator;

    constructor(private readonly page: Page) {
        this.hostButton = page.getByTestId('host-lobby');
        this.joinButton = page.getByTestId('join-lobby');
        this.readyButton = page.getByTestId('ready-toggle');
        this.startButton = page.getByTestId('start-game');
        this.playerList = page.getByTestId('player-list');
        this.sessionId = page.getByTestId('lobby-session-id');
        this.connectionStatus = page.getByTestId('connection-status');
    }

    async hostLobby(): Promise<void> {
        await this.hostButton.click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    async joinLobby(address: string): Promise<void> {
        await this.joinButton.click();
        await this.page.getByTestId('address-input').fill(address);
        await this.page.getByTestId('confirm-join').click();
        await this.connectionStatus.waitFor({ state: 'visible' });
    }

    async waitForPlayerCount(count: number): Promise<void> {
        await this.page
            .getByTestId('player-list-item')
            .nth(count - 1)
            .waitFor({ state: 'visible' });
    }

    async lobbyCode(): Promise<string> {
        await this.sessionId.waitFor({ state: 'visible' });
        return (await this.sessionId.innerText()).trim();
    }
}
```

### GamePage

```typescript
// apps/tactics/e2e/pages/GamePage.ts
import { Page, Locator } from '@playwright/test';

export class GamePage {
    readonly canvas: Locator;
    readonly undoButton: Locator;
    readonly redoButton: Locator;
    readonly endTurnButton: Locator;
    readonly gameResultBanner: Locator;
    readonly gameResultText: Locator;
    readonly hudTick: Locator;

    constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('game-canvas');
        this.undoButton = page.getByTestId('undo');
        this.redoButton = page.getByTestId('redo');
        this.endTurnButton = page.getByTestId('end-turn');
        this.gameResultBanner = page.getByTestId('game-result-banner');
        this.gameResultText = page.getByTestId('game-result-text');
        this.hudTick = page.getByTestId('hud-tick');
    }

    async currentTick(): Promise<number> {
        const text = await this.hudTick.innerText();
        return parseInt(text, 10);
    }

    async waitForTick(tick: number, timeout = 30_000): Promise<void> {
        await this.page.waitForFunction(
            (t) =>
                parseInt(
                    document.querySelector('[data-testid=hud-tick]')?.textContent ?? '0',
                    10,
                ) >= t,
            tick,
            { timeout },
        );
    }
}
```

---

## §13.7 Helpers

### ipc-spy.ts

```typescript
// apps/tactics/e2e/helpers/ipc-spy.ts
import type { ElectronApplication } from '@playwright/test';

/**
 * Read the last PlayerSnapshot delivered to the host renderer.
 * Requires CHIMERA_E2E=1 — main process stores it on globalThis.__e2eHooks.
 */
export async function getHostSnapshot(app: ElectronApplication): Promise<PlayerSnapshot | null> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastHostSnapshot ?? null);
}

/**
 * Retrieve the current tick from the simulation host (not the renderer).
 * Uses the same __e2eHooks mechanism — avoids reading from renderer DOM.
 */
export async function getSimulationTick(app: ElectronApplication): Promise<number> {
    return app.evaluate(() => globalThis.__e2eHooks?.currentTick ?? 0);
}

/**
 * Retrieve the last broadcast checksum keyed by projected viewer id.
 * Used by soak tests to compare the host's remote-viewer projection with
 * that same client's received projection, independent of broadcast ordering.
 */
export async function getLastBroadcastChecksums(
    app: ElectronApplication,
): Promise<Readonly<Record<string, number>>> {
    return app.evaluate(() => globalThis.__e2eHooks?.broadcastChecksums ?? {});
}

/**
 * Retrieve the qualified slot id persisted by the last successful save.
 * Returns null when __e2eHooks is absent or no save has completed yet.
 */
export async function getLastSavedSlotId(app: ElectronApplication): Promise<string | null> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastSavedSlotId ?? null);
}

/**
 * Retrieve the checkpoint tick captured by the last successful save.
 * Returns null when __e2eHooks is absent or no save has completed yet.
 */
export async function getLastSavedTick(app: ElectronApplication): Promise<number | null> {
    return app.evaluate(() => globalThis.__e2eHooks?.lastSavedTick ?? null);
}
```

### ws-inspector.ts

Provides read-only helpers to record and inspect raw WebSocket frames from the Electron main process via `electronApp.evaluate()`. Requires `CHIMERA_E2E=1` — the networking layer appends frames to `globalThis.__e2eHooks.wsFrames` when that flag is set.

**Ring-buffer capacity**: The main process caps the frame buffer at `MAX_WS_FRAMES = 10 000` entries (defined in `electron/main/runtime/e2e-hooks.ts`). When the limit is reached the oldest frame is evicted (FIFO drop), keeping memory bounded in long-running soak tests.

**Module boundary**: must NOT import from `electron/main/`, `simulation/`, or `networking/`. `ElectronApplication` is the only external import — it is a Playwright test type.

```typescript
// apps/tactics/e2e/helpers/ws-inspector.ts
import type { ElectronApplication } from '@playwright/test';

/**
 * WsFrame type derived from the globally-declared __e2eHooks shape
 * (electron/main/runtime/e2e-hooks.ts). Using typeof avoids a cross-module
 * import from electron/main/.
 */
export type WsFrame = NonNullable<NonNullable<typeof globalThis.__e2eHooks>['wsFrames']>[number];

/**
 * Ensure the WebSocket frame buffer is initialized on __e2eHooks.
 * Call once at the start of a test before any actions that generate WebSocket traffic.
 * Graceful no-op when CHIMERA_E2E is off (__e2eHooks absent).
 *
 * Does NOT modify, delay, or drop frames — only initialises the buffer so the
 * networking-layer hook can start appending (Invariant #6).
 */
export async function tapWebSocketFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<void> {
    await app.evaluate(() => {
        if (globalThis.__e2eHooks) {
            globalThis.__e2eHooks.wsFrames ??= [];
        }
    });
}

/**
 * Retrieve all WebSocket frames recorded since the last clearCapturedFrames()
 * (or since tapWebSocketFrames() if never cleared).
 * Returns [] when __e2eHooks is absent or the buffer has not been initialised.
 */
export async function getCapturedFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<WsFrame[]> {
    return app.evaluate(() => globalThis.__e2eHooks?.wsFrames ?? []);
}

/**
 * Reset the WebSocket frame buffer to empty.
 * Graceful no-op when CHIMERA_E2E is off (__e2eHooks absent).
 */
export async function clearCapturedFrames(
    app: Pick<ElectronApplication, 'evaluate'>,
): Promise<void> {
    await app.evaluate(() => {
        if (globalThis.__e2eHooks) {
            globalThis.__e2eHooks.wsFrames = [];
        }
    });
}
```

### tick-driver.ts

Programmatic tick-dispatch helper for soak specs. Dispatches a specified number of ticks to the simulation host via `electronApp.evaluate()`, calling `__e2eHooks.dispatchTick()` registered under `CHIMERA_E2E=1`.

**Batch semantics**: Ticks are dispatched in configurable batches (default `batchSize = 100`). After each batch — except the final one — the helper yields to the Node.js event loop via `setTimeout(0)` so pending I/O and IPC callbacks can drain before the next batch begins. This prevents flooding the message queue during high-count soak runs and keeps the host process responsive to Playwright interactions between batches.

**Graceful no-op**: When `__e2eHooks` is absent (i.e. `CHIMERA_E2E` is not set) the function resolves immediately without throwing.

**Module boundary**: must NOT import from `electron/main/`, `simulation/`, or `networking/`. `ElectronApplication` is the only external import — it is a Playwright test type.

```typescript
// apps/tactics/e2e/helpers/tick-driver.ts
import type { ElectronApplication } from '@playwright/test';

/** Number of ticks dispatched per batch before yielding to the event loop. */
const DEFAULT_BATCH_SIZE = 100;

/**
 * Dispatch `count` ticks to the simulation host via the CHIMERA_E2E hook.
 *
 * Ticks are dispatched in batches of `batchSize`. After each batch (except the
 * final one) the helper yields to the Node.js event loop via `setTimeout(0)` so
 * that pending I/O and IPC callbacks can drain before the next batch starts.
 *
 * Requires `CHIMERA_E2E=1` — `__e2eHooks.dispatchTick` must have been wired by
 * the session runtime before calling this function. When `__e2eHooks` is absent
 * the function resolves immediately without throwing.
 *
 * @param app       - The Playwright `ElectronApplication` for the host process.
 * @param count     - Total number of ticks to dispatch. `0` is a no-op.
 * @param batchSize - Ticks per batch before yielding (default: 100).
 */
export async function tick(
    app: ElectronApplication,
    count: number,
    batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<void> {
    const safeBatchSize = Math.max(1, batchSize);
    let dispatched = 0;

    while (dispatched < count) {
        const batch = Math.min(count - dispatched, safeBatchSize);

        await app.evaluate((_electron, n: number) => {
            for (let i = 0; i < n; i++) {
                globalThis.__e2eHooks?.dispatchTick();
            }
        }, batch);

        dispatched += batch;

        if (dispatched < count) {
            // Yield to the event loop between batches to prevent flooding.
            await app.evaluate(() => new Promise<void>((r) => setTimeout(r, 0)));
        }
    }
}
```

### snapshot-assert.ts

```typescript
// apps/tactics/e2e/helpers/snapshot-assert.ts
import { expect } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { getLastBroadcastChecksums, getSimulationTick } from './ipc-spy';

/**
 * PlayerSnapshot type derived from the globally-declared __e2eHooks shape
 * (electron/main/runtime/e2e-hooks.ts). Using typeof avoids a cross-module
 * import from electron/main/ or simulation/.
 */
type PlayerSnapshot = NonNullable<NonNullable<typeof globalThis.__e2eHooks>['lastHostSnapshot']>;

/**
 * Assert that a PlayerSnapshot contains no fields classified owner-only for
 * another player. Fields tagged with `__visibility: 'owner-only'` must be
 * absent (or null) in any non-owner snapshot.
 *
 * The scan is a full recursive descent through nested objects and arrays so
 * that deeply-nested visibility markers (e.g. `player.hand.cards[0].__visibility`)
 * are not missed. A WeakSet guards against circular references.
 *
 * NOTE: **all** non-viewer players are scanned, not only `snapshotOwner`.
 * `snapshotOwner` is used solely for the early-exit guard when
 * `viewerId === snapshotOwner`.
 *
 * @param snapshot      - The PlayerSnapshot to inspect.
 * @param viewerId      - The player receiving this snapshot.
 * @param snapshotOwner - The player who owns the sensitive data being tested.
 *                        Used only for the early-exit guard; all non-viewer
 *                        players are always scanned.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: string,
    snapshotOwner: string,
): void {
    if (viewerId === snapshotOwner) return;

    const visited = new WeakSet<object>();
    const leaked: string[] = [];

    function scan(value: unknown, playerId: string, path: string): void {
        if (value === null || typeof value !== 'object') return;
        const obj = value as Record<string, unknown>;
        if (visited.has(obj)) return;
        visited.add(obj);

        if ((obj as { __visibility?: string }).__visibility === 'owner-only') {
            leaked.push(`player=${playerId} path=${path}`);
            return; // do not descend further into an already-flagged subtree
        }

        for (const [key, child] of Object.entries(obj)) {
            scan(child, playerId, `${path}.${key}`);
        }
    }

    for (const [playerId, playerState] of Object.entries(snapshot.players)) {
        if (playerId !== viewerId) {
            scan(playerState, playerId, `players.${playerId}`);
        }
    }

    expect(
        leaked,
        `Snapshot for viewer=${viewerId} leaked owner-only fields: ${leaked.join(', ')}`,
    ).toHaveLength(0);
}

export async function assertChecksumMatch(
    hostApp: ElectronApplication,
    clientApp: ElectronApplication,
): Promise<void> {
    const [hostChecksums, clientChecksums] = await Promise.all([
        getLastBroadcastChecksums(hostApp),
        getLastBroadcastChecksums(clientApp),
    ]);
    const clientEntries = Object.entries(clientChecksums);
    expect(clientEntries).toHaveLength(1);
    const clientEntry = clientEntries[0]!;
    const [clientId, clientChecksum] = clientEntry;
    expect(hostChecksums[clientId]).toBe(clientChecksum);
}

export async function assertTickAdvanced(
    app: ElectronApplication,
    baseline: number,
): Promise<void> {
    const tick = await getSimulationTick(app);
    expect(tick).toBeGreaterThan(baseline);
}
```

---

## §13.8 Test Specifications

### lobby.spec.ts

```typescript
// apps/tactics/e2e/tests/lobby.spec.ts
import { test, expect } from '../fixtures/lobby.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';
import { LobbyPage } from '../pages/LobbyPage';

test.describe('Lobby lifecycle', () => {
    test('host creates lobby; client joins; player list syncs in both windows', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostMainMenu = new MainMenuPage(hostWindow);
        const clientMainMenu = new MainMenuPage(clientWindow);

        await hostMainMenu.navigateToLobby();
        await clientMainMenu.navigateToLobby();

        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        await hostLobby.hostLobby();
        const lobbyCode = await hostLobby.lobbyCode();
        await clientLobby.joinLobby(lobbyCode);
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);
        await expect(hostLobby.connectionStatus).toHaveAttribute('data-status', 'connected');
        await expect(clientLobby.connectionStatus).toHaveAttribute('data-status', 'connected');
    });
});
```

### game-flow.spec.ts

```typescript
// apps/tactics/e2e/tests/game-flow.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Game flow', () => {
    test('host and client reach game-over state', async ({ hostWindow, clientWindow }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        await expect(hostGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientGame.gameResultBanner).toBeVisible({ timeout: 60_000 });
    });
});
```

### undo-redo.spec.ts

```typescript
// apps/tactics/e2e/tests/undo-redo.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { GamePage } from '../pages/GamePage';

test.describe('Undo/redo', () => {
    test('undo reflects canUndo=false after exhausting turn history', async ({ hostWindow }) => {
        const hostGame = new GamePage(hostWindow);
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();
        await expect(hostGame.undoButton).toBeEnabled();
        await hostGame.undoButton.click();
        await expect(hostGame.undoButton).toBeDisabled();
        await expect(hostGame.redoButton).toBeEnabled();
    });
});
```

### obfuscation.spec.ts

```typescript
// apps/tactics/e2e/tests/obfuscation.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { getHostSnapshot } from '../helpers/ipc-spy';
import { assertNoLeakedFields } from '../helpers/snapshot-assert';

test.describe('State obfuscation', () => {
    test('host snapshot contains no opponent owner-only fields', async ({ hostApp }) => {
        const snapshot = await getHostSnapshot(hostApp);
        assertNoLeakedFields(snapshot, snapshot.viewerId, 'p2');
    });

    test('fog-of-war: invisible entities absent from opponent snapshot', async ({ hostApp }) => {
        const snapshot = await getHostSnapshot(hostApp);
        const leaked = Object.values(snapshot.entities).filter((e) => e.__fogHidden === true);
        expect(leaked).toHaveLength(0);
    });
});
```

### multiplayer-soak.spec.ts

```typescript
// apps/tactics/e2e/tests/multiplayer-soak.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { assertChecksumMatch } from '../helpers/snapshot-assert';
import { tick } from '../helpers/tick-driver';

test.describe('Multiplayer soak', () => {
    test('checksums converge after 1000 ticks', async ({ hostApp, clientApp }) => {
        await tick(hostApp, 1000);
        const simTick = await getSimulationTick(hostApp);
        expect(simTick).toBeGreaterThanOrEqual(1000);
        await expect.poll(() => getSimulationTick(clientApp)).toBeGreaterThanOrEqual(simTick);
        await assertChecksumMatch(hostApp, clientApp);
    });
});
```

### save-load.spec.ts

Single-player persistence spec built on the `saveLoadApp` / `saveLoadWindow` fixture pair. It plays three turns in pass-and-play mode, saves through the preload bridge, reads the exact saved slot and checkpoint tick from `__e2eHooks.lastSavedSlotId` / `lastSavedTick`, captures the relaunch args/env, closes the Electron process, relaunches with the same `--user-data-dir`, loads the saved slot, and asserts that the simulation tick matches the saved checkpoint tick.

This spec exercises the save/restore invariants for atomic persistence and restored commitments: it relies on the save IPC returning only after the atomic rename, on the load IPC being the only restore entry point, and on the restored session resuming at the same tick after relaunch.

```typescript
// apps/tactics/e2e/tests/save-load.spec.ts
import { test, expect } from '../fixtures/electron.fixture';
import { getLastSavedSlotId, getLastSavedTick, getSimulationTick } from '../helpers/ipc-spy';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { GamePage } from '../pages/GamePage';

test.describe('Save / load', () => {
    test('tick is restored to pre-save value after relaunch + load', async ({
        saveLoadApp,
        saveLoadWindow,
    }) => {
        const match = new GamePage(saveLoadWindow);
        await expect(match.canvas).toBeVisible({ timeout: 30_000 });

        for (let turn = 0; turn < 3; turn++) {
            await match.moveOwnedUnit();
            await match.endTurnButton.click();
            await expect(match.endTurnButton).toBeEnabled({ timeout: 30_000 });
        }

        await saveLoadWindow.evaluate(() =>
            globalThis.__chimera.saves.save({ gameId: '<game>', label: 'save-load-spec' }),
        );
        const slotId = await getLastSavedSlotId(saveLoadApp);
        const savedTick = await getLastSavedTick(saveLoadApp);
        expect(slotId).not.toBeNull();
        expect(savedTick).toBeGreaterThan(0);

        const relaunchConfig = await captureRelaunchConfig(saveLoadApp);
        await saveLoadApp.close();
        const relaunchedApp = await relaunchElectronApplication(relaunchConfig);
        const relaunchedWindow = await relaunchedApp.firstWindow();
        await relaunchedWindow.evaluate((id) => globalThis.__chimera.saves.load(id), slotId);

        await expect.poll(() => getSimulationTick(relaunchedApp)).toBe(savedTick);
    });
});
```

### settings-persistence.spec.ts

Settings persistence spec built on an Electron instance launched directly to `/settings`. It changes `audio.masterVolume` through the `SettingsPage` page object, verifies the value through the renderer-facing settings bridge, relaunches with the same `--user-data-dir`, and asserts the displayed value persists. A second test resets settings to defaults, verifies the engine default immediately, relaunches again, and verifies the reset persisted.

The spec intentionally reads only `window.__chimera.settings` and Settings page DOM state. It never inspects `GameSnapshot`, `SaveFile`, `PlayerSnapshot`, or simulation internals, preserving invariant #32.

```typescript
// apps/tactics/e2e/tests/settings-persistence.spec.ts
test.describe('Settings persistence', () => {
    test('masterVolume persists across relaunch', async ({ settingsApp, settingsWindow }) => {
        const settingsPage = new SettingsPage(settingsWindow);
        await settingsPage.setMasterVolume(0.42);
        await expectPersistedMasterVolume(settingsWindow, 0.42);

        const relaunched = await relaunchSettingsApp(settingsApp);
        await expectDisplayedMasterVolume(new SettingsPage(relaunched.window), 0.42);
    });

    test('reset returns masterVolume to default and persists across relaunch', async ({
        settingsApp,
        settingsWindow,
    }) => {
        await new SettingsPage(settingsWindow).setMasterVolume(0.42);
        const persistedRelaunch = await relaunchSettingsApp(settingsApp);

        const settingsPage = new SettingsPage(persistedRelaunch.window);
        await settingsPage.resetToDefaults();
        await expectPersistedMasterVolume(persistedRelaunch.window, 1.0);

        const resetRelaunch = await relaunchSettingsApp(persistedRelaunch.app);
        await expectDisplayedMasterVolume(new SettingsPage(resetRelaunch.window), 1.0);
    });
});
```

---

## §13.9 Test Hooks in Main Process (`__e2eHooks`)

```typescript
// electron/main/runtime/e2e-hooks.ts — behind env guard

export interface E2eHooks {
    readonly lastHostSnapshot: PlayerSnapshot | null;
    readonly lastChecksum: number;
    readonly broadcastChecksums: Readonly<Record<string, number>>;
    readonly currentTick: number;
    lastSavedSlotId: string | null;
    lastSavedTick: number | null;
    firstPlayerRole: 'host' | 'client';
    directGameLobbyCode: string | null;
    wsFrames: WsFrame[] | undefined;
    pushWsFrame(frame: WsFrame): void;
    onBroadcastChecksum(tick: number, viewerId: string, checksum: number): void;
    onTick(tick: number, checksum: number, snapshot: PlayerSnapshot): void;
    onClockTick(tick: number, viewerId: string): void;
    dispatchTick: () => void;
}

export function registerE2eHooks(env = process.env): E2eHooks | undefined {
    if (env['CHIMERA_E2E'] !== '1') {
        Reflect.deleteProperty(globalThis, '__e2eHooks');
        return undefined;
    }

    const hooks = createE2eHooks();
    globalThis.__e2eHooks = hooks;
    return hooks;
}
```

The hook object is created by `createE2eHooks()` and registered only when `CHIMERA_E2E=1`; absent or `0` deletes the global hook. The surface is primarily **read-only from tests** — tests inspect state and do not mutate snapshots directly. `lastSavedSlotId` and `lastSavedTick` are set internally after successful save operations so persistence specs can load the exact saved slot without hardcoding. `wsFrames` is activated by `tapWebSocketFrames()` and written through `pushWsFrame()` so capture remains bounded by `MAX_WS_FRAMES`. `dispatchTick` allows soak specs to programmatically advance the simulation clock through the wired `ActionPipeline` path.

Until the session runtime wires active methods, `dispatchTick` throws loudly. Session startup replaces it with a function that routes through the real pipeline; no test code injects snapshot state.

---

## §13.10 CHIMERA_E2E Flag Contract

| Value        | Behaviour                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Absent / `0` | Production mode. `__e2eHooks` not set.                                                                            |
| `1`          | Test mode. `__e2eHooks` registered. Fixed `CHIMERA_PORT` from env respected. Lobby auto-connect skips NAT checks. |

The flag is not forwarded to the renderer process. Main-process code paths that branch on `CHIMERA_E2E`:

| Location                                          | Effect                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime/e2e-hooks.ts`                            | Registers `__e2eHooks` on `globalThis` only when `CHIMERA_E2E=1`; deletes the hook otherwise.                                                                                                                                                                                                                                                                          |
| `runtime/SessionRuntime.ts`                       | Wires `dispatchTick` through the real tick action path.                                                                                                                                                                                                                                                                                                                |
| `lobby-manager.ts`                                | Binds to a fixed `CHIMERA_PORT`; skips NAT checks.                                                                                                                                                                                                                                                                                                                     |
| `electron/main/index.ts` — `createWindow` closure | Reads `CHIMERA_E2E_INITIAL_URL` and, after validation through `sanitiseE2eInitialUrl`, passes it as `initialUrl` to `createMainWindow` so the window opens on a specific app route. Only `chimera://renderer/…` URLs are accepted; any other value (remote URL, wrong protocol, malformed string) is silently replaced by the default `chimera://renderer/index.html`. |

---

## §13.11 CI Integration

```yaml
# .github/workflows/e2e.yml
jobs:
    e2e:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version: '20' }
            - run: npm ci
            - run: npm run build:renderer
            - run: npm run build:electron
            - name: Install Playwright browsers
              run: npx playwright install --with-deps chromium
            - name: Run E2E tests
              run: npx playwright test --project=electron-e2e
              env:
                  CI: true
                  DISPLAY: ':99' # Xvfb for headless Electron on Linux
            - uses: actions/upload-artifact@v4
              if: always()
              with:
                  name: playwright-report
                  path: apps/tactics/e2e/playwright-report/
```

On macOS runners, `DISPLAY` is not required. On Linux, an `Xvfb` step is needed because Electron requires a display server.

---

## §13.12 Security Notes

| Concern               | Rule                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test hook surface     | `__e2eHooks` exposes only `dispatchTick` as an active method; all other fields are read-only from tests. All dispatched ticks go through `ActionPipeline`. |
| Isolated ports        | Each test suite uses a dedicated port (`CHIMERA_PORT`). `workers: 1` prevents fixed-port collision.                                                        |
| No credentials in env | `CHIMERA_E2E` env block must never log or expose lobby tokens, seeds, or player data.                                                                      |
| Production gate       | `CHIMERA_E2E` is never set in production packaging scripts. `electron-builder` config explicitly omits it.                                                 |

---

## Cross-References

- [Testing Strategy (Unit/Property)](property-tests-soak.md) — Vitest, fast-check, CI gates
- [Dev Tooling & Harness](../core-components/dev-tooling.md) — interactive dev harness (non-automated counterpart)
- [Runtime Debug Layer](../core-components/runtime-debug-layer.md) — `CHIMERA_DEBUG` flag pattern (same guard mechanism)
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants referenced in security notes
