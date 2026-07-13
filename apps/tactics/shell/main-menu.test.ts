// apps/tactics/shell/main-menu.test.ts
//
// Unit tests for the Tactics main menu definition and command registry.
// Written first (TDD — red confirmed before implementation).
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
// Task: #620
//
// Module boundary enforced by import statement below:
//   - apps/tactics/shell/ may import from shared/ only (not renderer/)

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMainMenuDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type {
    PerspectiveReplayListBridge,
    ReplayListBridge,
} from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';
import { tacticsMainMenuDefinition, tacticsMenuCommands } from './main-menu';

// ─── Export shape ─────────────────────────────────────────────────────────────

describe('tacticsMainMenuDefinition shape', () => {
    it('is a GameMainMenuDefinition', () => {
        const _: GameMainMenuDefinition = tacticsMainMenuDefinition;
        expect(tacticsMainMenuDefinition).toBeDefined();
    });

    it('has a buttons array with at least 4 entries', () => {
        expect(tacticsMainMenuDefinition.buttons.length).toBeGreaterThanOrEqual(4);
    });
});

// ─── Button labels ────────────────────────────────────────────────────────────
//
// After i18n adoption the definition stores `game.tactics.menu.*`
// translation-token KEYS as labels; the engine renderer resolves each through
// `t()` at render. These tests assert the stored token keys, not the rendered
// English text (that is covered by the bundle parity test + screen tests).

describe('button labels', () => {
    function findButton(label: string) {
        return tacticsMainMenuDefinition.buttons.find((b) => b.label === label);
    }

    it('includes a "New Game" button', () => {
        expect(findButton('game.tactics.menu.newGame')).toBeDefined();
    });

    it('includes a "Load Game" button', () => {
        expect(findButton('game.tactics.menu.loadGame')).toBeDefined();
    });

    it('includes a "Settings" button', () => {
        expect(findButton('game.tactics.menu.settings')).toBeDefined();
    });

    it('includes a "Quit" button', () => {
        expect(findButton('game.tactics.menu.quit')).toBeDefined();
    });

    it('includes a "Replays" button', () => {
        expect(findButton('game.tactics.menu.replays')).toBeDefined();
    });

    it('buttons appear in the correct order: New Game, Load Game, Settings, Replays, Quit', () => {
        const labels = tacticsMainMenuDefinition.buttons.map((b) => b.label);
        expect(labels).toEqual([
            'game.tactics.menu.newGame',
            'game.tactics.menu.loadGame',
            'game.tactics.menu.settings',
            'game.tactics.menu.replays',
            'game.tactics.menu.quit',
        ]);
    });
});

// ─── Button actions ───────────────────────────────────────────────────────────

describe('button actions', () => {
    function findButton(label: string) {
        const btn = tacticsMainMenuDefinition.buttons.find((b) => b.label === label);
        if (!btn) throw new Error(`Button "${label}" not found`);
        return btn;
    }

    it('"New Game" opens the lobby through the shell context', () => {
        const btn = findButton('game.tactics.menu.newGame');
        expect(btn.action.type).toBe('open-lobby');
    });

    it('"Load Game" navigates to /saves', () => {
        const btn = findButton('game.tactics.menu.loadGame');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/saves');
        }
    });

    it('"Settings" navigates to /settings', () => {
        const btn = findButton('game.tactics.menu.settings');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/settings');
        }
    });

    it('"Replays" navigates to /replays', () => {
        const btn = findButton('game.tactics.menu.replays');
        expect(btn.action.type).toBe('navigate');
        if (btn.action.type === 'navigate') {
            expect(btn.action.target).toBe('/replays');
        }
    });

    it('"Quit" has action type "quit"', () => {
        const btn = findButton('game.tactics.menu.quit');
        expect(btn.action.type).toBe('quit');
    });
});

// ─── Button variants ──────────────────────────────────────────────────────────

describe('button variants', () => {
    function findButton(label: string) {
        return tacticsMainMenuDefinition.buttons.find((b) => b.label === label)!;
    }

    it('"New Game" is primary variant', () => {
        expect(findButton('game.tactics.menu.newGame').variant).toBe('primary');
    });

    it('"Quit" is danger variant', () => {
        expect(findButton('game.tactics.menu.quit').variant).toBe('danger');
    });

    it('"Replays" is secondary variant', () => {
        expect(findButton('game.tactics.menu.replays').variant).toBe('secondary');
    });
});

// ─── Replays button availability check (F44 T7 — #661) ──────────────────────────
//
// The Replays button is disabled when there are no replays to browse — of EITHER
// kind (deterministic or perspective; both are saved only on an explicit save, not
// at game-over). The check reads the Chimera bridge off `globalThis` (the renderer
// process exposes `window.__chimera`, which is `globalThis.__chimera` at runtime).
// These tests stub that global — no jsdom/window required.

describe('Replays button disabled() check', () => {
    // The stub is typed against the SHARED bridge contracts the production module
    // reads (`ReplayListBridge` + `PerspectiveReplayListBridge`), so the test and
    // `main-menu.ts` stay pinned to the same surface — no drift between them.
    interface Bridges {
        deterministic?: ReplayListBridge;
        perspective?: PerspectiveReplayListBridge;
    }

    function setBridge(bridges: Bridges | undefined): void {
        if (bridges === undefined) {
            Reflect.deleteProperty(globalThis, '__chimera');
            return;
        }
        const deterministic = bridges.deterministic ?? {
            list: async (): Promise<readonly unknown[]> => [],
        };
        const perspective = bridges.perspective ?? {
            list: async (): Promise<readonly string[]> => [],
        };
        (
            globalThis as {
                __chimera?: {
                    replay: ReplayListBridge & { perspective: PerspectiveReplayListBridge };
                };
            }
        ).__chimera = { replay: { ...deterministic, perspective } };
    }

    function getDisabledCheck(): () => Promise<boolean> {
        const btn = tacticsMainMenuDefinition.buttons.find(
            (b) => b.label === 'game.tactics.menu.replays',
        );
        if (!btn || typeof btn.disabled !== 'function') {
            throw new Error('Replays button is missing an async disabled() check');
        }
        return btn.disabled;
    }

    afterEach(() => {
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('declares an async disabled() check (a function, not a static boolean)', () => {
        expect(typeof getDisabledCheck()).toBe('function');
    });

    it('disables the button when neither deterministic nor perspective replays exist', async () => {
        const deterministicList = vi.fn(async (): Promise<readonly unknown[]> => []);
        const perspectiveList = vi.fn(async (): Promise<readonly string[]> => []);
        setBridge({
            deterministic: { list: deterministicList },
            perspective: { list: perspectiveList },
        });

        await expect(getDisabledCheck()()).resolves.toBe(true);
        expect(deterministicList).toHaveBeenCalledWith('tactics');
        expect(perspectiveList).toHaveBeenCalledWith('tactics');
    });

    it('enables the button when at least one DETERMINISTIC replay exists (none perspective)', async () => {
        setBridge({
            deterministic: {
                list: async (): Promise<readonly unknown[]> => [
                    { path: '/saves/d1.chimera-replay' },
                ],
            },
        });

        await expect(getDisabledCheck()()).resolves.toBe(false);
    });

    it('enables the button when at least one PERSPECTIVE replay exists (none deterministic)', async () => {
        setBridge({
            perspective: {
                list: async (): Promise<readonly string[]> => [
                    '/saves/p1.chimera-perspective-replay',
                ],
            },
        });

        await expect(getDisabledCheck()()).resolves.toBe(false);
    });

    it('disables the button (fail-safe) when the bridge is unavailable', async () => {
        setBridge(undefined);

        await expect(getDisabledCheck()()).resolves.toBe(true);
    });
});

// ─── Layout ───────────────────────────────────────────────────────────────────

describe('layout', () => {
    it('uses vertical orientation', () => {
        expect(tacticsMainMenuDefinition.layout?.orientation).toBe('vertical');
    });

    it('anchors to center', () => {
        expect(tacticsMainMenuDefinition.layout?.anchor).toBe('center');
    });

    it('has a defined numeric gap', () => {
        expect(typeof tacticsMainMenuDefinition.layout?.gap).toBe('number');
    });

    it('gap value is a valid token-mapped spacing (0, 4, 8, 16, 24, or 40)', () => {
        const validGaps = [0, 4, 8, 16, 24, 40];
        expect(validGaps).toContain(tacticsMainMenuDefinition.layout?.gap);
    });
});

// ─── tacticsMenuCommands ──────────────────────────────────────────────────────

describe('tacticsMenuCommands shape', () => {
    it('is empty because the current menu uses built-in shell actions only', () => {
        expect(tacticsMenuCommands).toEqual({});
    });
});
