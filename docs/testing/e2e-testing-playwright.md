---
title: 'E2E Testing Layer (Playwright)'
description: 'Playwright-driven E2E suite for real Electron instances. Covers tooling rationale, directory structure, playwright.config.ts, electron.fixture.ts, lobby.fixture.ts, LobbyPage/MatchPage POMs, ipc-spy.ts, snapshot-assert.ts, tick-driver.ts, all test specs (lobby/match-flow/undo-redo/obfuscation/reconnect/multiplayer-soak), __e2eHooks main-process contract, CHIMERA_E2E flag, CI YAML, and security notes.'
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
e2e/
├── playwright.config.ts
├── playwright.config.test.ts    # Vitest shape-check — validates config values without launching Electron (deliberate)
├── lobby.fixture.test.ts        # Vitest shape-check — validates lobby.fixture exports without launching Electron (deliberate)
├── global-setup.ts
├── fixtures/
│   ├── electron.fixture.ts      # Base: launch / close one ElectronApplication
│   ├── lobby.fixture.ts         # Extends base: two instances + lobby helpers
│   └── game.fixture.ts          # Extends lobby: match started, tick driver wired
├── pages/
│   ├── MainMenuPage.ts
│   ├── LobbyPage.ts             # POM: host/join/ready/start
│   ├── MatchPage.ts             # POM: HUD, undo/redo, game-over
│   └── SettingsPage.ts
├── helpers/
│   ├── ipc-spy.ts               # Read main-process state via electronApp.evaluate()
│   ├── ws-inspector.ts          # Tap raw WebSocket frames
│   ├── snapshot-assert.ts       # assertNoLeakedFields(), assertTickAdvanced(), assertChecksumMatch()
│   └── tick-driver.ts           # Programmatic tick dispatch — used in soak specs
└── tests/
    ├── lobby.spec.ts
    ├── match-flow.spec.ts
    ├── undo-redo.spec.ts
    ├── obfuscation.spec.ts
    ├── reconnect.spec.ts
    └── multiplayer-soak.spec.ts
```

> **Note — Vitest shape-check files in `e2e/` root:** `playwright.config.test.ts` and
> `lobby.fixture.test.ts` are intentional Vitest unit tests co-located at the `e2e/` root
> (§12.3 pattern). They validate module-level exports and config values without launching
> Electron, so failures surface in the fast Vitest run rather than only during a full E2E
> run. Playwright's `testDir: './tests'` correctly excludes them; they are picked up by
> Vitest's `include` glob instead.

---

## §13.4 Playwright Configuration

```typescript
// e2e/playwright.config.ts
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false, // Multiplayer tests bind to fixed localhost ports — run serially
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
// e2e/fixtures/electron.fixture.ts
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
// e2e/fixtures/lobby.fixture.ts
export const test = electronTest.extend<LobbyFixtures>({
    hostApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7779',
                CHIMERA_ROLE: 'host',
            },
        });
        await use(app);
        await app.close();
    },
    clientApp: async ({}, use) => {
        const app = await electron.launch({
            args: [path.resolve(__dirname, '../../electron/main/index.js')],
            env: {
                ...process.env,
                CHIMERA_E2E: '1',
                NODE_ENV: 'test',
                CHIMERA_PORT: '7779',
                CHIMERA_ROLE: 'client',
            },
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

---

## §13.6 Page Objects

### LobbyPage

```typescript
// e2e/pages/LobbyPage.ts
import { Page, Locator } from '@playwright/test';

export class LobbyPage {
    readonly hostButton: Locator;
    readonly joinButton: Locator;
    readonly readyButton: Locator;
    readonly startButton: Locator;
    readonly playerList: Locator;
    readonly connectionStatus: Locator;

    constructor(private readonly page: Page) {
        this.hostButton = page.getByTestId('host-lobby');
        this.joinButton = page.getByTestId('join-lobby');
        this.readyButton = page.getByTestId('ready-toggle');
        this.startButton = page.getByTestId('start-match');
        this.playerList = page.getByTestId('player-list');
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
}
```

### MatchPage

```typescript
// e2e/pages/MatchPage.ts
import { Page, Locator } from '@playwright/test';

export class MatchPage {
    readonly canvas: Locator;
    readonly undoButton: Locator;
    readonly redoButton: Locator;
    readonly endTurnButton: Locator;
    readonly gameOverBanner: Locator;
    readonly hudTick: Locator;

    constructor(private readonly page: Page) {
        this.canvas = page.getByTestId('match-canvas');
        this.undoButton = page.getByTestId('undo');
        this.redoButton = page.getByTestId('redo');
        this.endTurnButton = page.getByTestId('end-turn');
        this.gameOverBanner = page.getByTestId('game-over-banner');
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
// e2e/helpers/ipc-spy.ts
import { ElectronApplication } from 'playwright';
import { PlayerSnapshot } from '../../shared/snapshot';

/**
 * Read the last PlayerSnapshot delivered to the host renderer.
 * Requires CHIMERA_E2E=1 — main process stores it on globalThis.__e2eHooks.
 */
export async function getHostSnapshot(app: ElectronApplication): Promise<PlayerSnapshot> {
    return app.evaluate(() => (globalThis as Record<string, unknown>).__e2eHooks?.lastHostSnapshot);
}

/**
 * Retrieve the current tick from the simulation host (not the renderer).
 * Uses the same __e2eHooks mechanism — avoids reading from renderer DOM.
 */
export async function getSimulationTick(app: ElectronApplication): Promise<number> {
    return app.evaluate(() => (globalThis as Record<string, unknown>).__e2eHooks?.currentTick ?? 0);
}

/**
 * Retrieve the last checksum broadcast by StateBroadcaster.
 * Used by soak tests to compare host vs client convergence.
 */
export async function getLastBroadcastChecksum(app: ElectronApplication): Promise<number> {
    return app.evaluate(
        () => (globalThis as Record<string, unknown>).__e2eHooks?.lastChecksum ?? 0,
    );
}
```

### snapshot-assert.ts

```typescript
// e2e/helpers/snapshot-assert.ts
import { expect } from '@playwright/test';
import { PlayerSnapshot } from '../../shared/snapshot';

/**
 * Assert that a PlayerSnapshot contains no fields classified owner-only for another player.
 * Fields tagged with __visibility: 'owner-only' must be null/undefined in non-owner snapshots.
 */
export function assertNoLeakedFields(
    snapshot: PlayerSnapshot,
    viewerId: string,
    ownerId: string,
): void {
    if (viewerId === ownerId) return; // own snapshot — all fields permitted
    for (const [playerId, playerState] of Object.entries(snapshot.players)) {
        if (playerId !== viewerId) {
            // Any field on opponent players that is explicitly marked owner-only must be absent
            const leaked = Object.entries(playerState as Record<string, unknown>).filter(
                ([, v]) => (v as { __visibility?: string })?.__visibility === 'owner-only',
            );
            expect(
                leaked,
                `Snapshot for viewer=${viewerId} leaked owner-only field from player=${playerId}`,
            ).toHaveLength(0);
        }
    }
}

export async function assertChecksumMatch(
    hostApp: import('playwright').ElectronApplication,
    clientApp: import('playwright').ElectronApplication,
): Promise<void> {
    const { getLastBroadcastChecksum } = await import('./ipc-spy');
    const hostChecksum = await getLastBroadcastChecksum(hostApp);
    const clientChecksum = await getLastBroadcastChecksum(clientApp);
    expect(hostChecksum).toBe(clientChecksum);
}
```

---

## §13.8 Test Specifications

### lobby.spec.ts

```typescript
// e2e/tests/lobby.spec.ts
import { test, expect } from '../fixtures/lobby.fixture';
import { LobbyPage } from '../pages/LobbyPage';

test.describe('Lobby lifecycle', () => {
    test('host creates lobby; client joins; player list syncs in both windows', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        await hostLobby.hostLobby();
        await clientLobby.joinLobby('localhost:7779');
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);
        await expect(hostLobby.connectionStatus).toContainText('Connected');
        await expect(clientLobby.connectionStatus).toContainText('Connected');
    });
});
```

### match-flow.spec.ts

```typescript
// e2e/tests/match-flow.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Match flow', () => {
    test('host and client reach game-over state', async ({ hostWindow, clientWindow }) => {
        const hostMatch = new MatchPage(hostWindow);
        const clientMatch = new MatchPage(clientWindow);
        await expect(hostMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
        await expect(clientMatch.gameOverBanner).toBeVisible({ timeout: 60_000 });
    });
});
```

### undo-redo.spec.ts

```typescript
// e2e/tests/undo-redo.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { MatchPage } from '../pages/MatchPage';

test.describe('Undo/redo', () => {
    test('undo reflects canUndo=false after exhausting turn history', async ({ hostWindow }) => {
        const hostMatch = new MatchPage(hostWindow);
        await hostWindow.getByTestId('selectable-unit').first().click();
        await hostWindow.getByTestId('move-target').first().click();
        await expect(hostMatch.undoButton).toBeEnabled();
        await hostMatch.undoButton.click();
        await expect(hostMatch.undoButton).toBeDisabled();
        await expect(hostMatch.redoButton).toBeEnabled();
    });
});
```

### obfuscation.spec.ts

```typescript
// e2e/tests/obfuscation.spec.ts
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
// e2e/tests/multiplayer-soak.spec.ts
import { test, expect } from '../fixtures/game.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { assertChecksumMatch } from '../helpers/snapshot-assert';
import { tick } from '../helpers/tick-driver';

test.describe('Multiplayer soak', () => {
    test('checksums converge after 1000 ticks', async ({ hostApp, clientApp }) => {
        await tick(hostApp, 1000);
        await hostApp.evaluate(() => new Promise((r) => setTimeout(r, 200)));
        const simTick = await getSimulationTick(hostApp);
        expect(simTick).toBeGreaterThanOrEqual(1000);
        await assertChecksumMatch(hostApp, clientApp);
    });
});
```

---

## §13.9 Test Hooks in Main Process (`__e2eHooks`)

```typescript
// electron/main/simulation-host.ts — behind env guard

if (process.env.CHIMERA_E2E === '1') {
    (globalThis as Record<string, unknown>).__e2eHooks = {
        lastHostSnapshot: null as PlayerSnapshot | null,
        lastChecksum: 0,
        currentTick: 0,
        onTick(tick: number, checksum: number, hostSnapshot: PlayerSnapshot): void {
            this.currentTick = tick;
            this.lastChecksum = checksum;
            this.lastHostSnapshot = hostSnapshot;
        },
    };
}
```

The block is a compile-time dead-code elimination target in production builds. The hook surface is **read-only from tests** — tests inspect state; they do not inject actions or mutate snapshots.

---

## §13.10 CHIMERA_E2E Flag Contract

| Value        | Behaviour                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Absent / `0` | Production mode. `__e2eHooks` not set.                                                                            |
| `1`          | Test mode. `__e2eHooks` registered. Fixed `CHIMERA_PORT` from env respected. Lobby auto-connect skips NAT checks. |

The flag is not forwarded to the renderer process. No production code path branches on `CHIMERA_E2E` outside `simulation-host.ts` and `lobby-manager.ts` (provider port binding).

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
                  path: e2e/playwright-report/
```

On macOS runners, `DISPLAY` is not required. On Linux, an `Xvfb` step is needed because Electron requires a display server.

---

## §13.12 Security Notes

| Concern               | Rule                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Test hook surface     | `__e2eHooks` is read-only from tests. All actions still go through `ActionPipeline`.                       |
| Isolated ports        | Each test suite uses a dedicated port (`CHIMERA_PORT`). `fullyParallel: false` prevents collision.         |
| No credentials in env | `CHIMERA_E2E` env block must never log or expose lobby tokens, seeds, or player data.                      |
| Production gate       | `CHIMERA_E2E` is never set in production packaging scripts. `electron-builder` config explicitly omits it. |

---

## Cross-References

- [Testing Strategy (Unit/Property)](property-tests-soak.md) — Vitest, fast-check, CI gates
- [Dev Tooling & Harness](../core-components/dev-tooling.md) — interactive dev harness (non-automated counterpart)
- [Runtime Debug Layer](../core-components/runtime-debug-layer.md) — `CHIMERA_DEBUG` flag pattern (same guard mechanism)
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants referenced in security notes
