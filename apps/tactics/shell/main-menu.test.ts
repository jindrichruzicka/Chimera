// apps/tactics/shell/main-menu.test.ts
//
// Unit tests for the Tactics main menu definition and command registry.
// Written first (TDD — red confirmed before implementation).
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
//
// Module boundary enforced by import statement below:
//   - this module's workspace imports are simulation/foundation/ and own Tactics
//     files only (not renderer/)

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

    it('includes a "Continue" button', () => {
        expect(findButton('game.tactics.menu.continue')).toBeDefined();
    });

    it('includes a "Quick Match" button', () => {
        expect(findButton('game.tactics.menu.quickMatch')).toBeDefined();
    });

    it('lists the two match entries above the lobby flow, then the browsers, then Quit', () => {
        const labels = tacticsMainMenuDefinition.buttons.map((b) => b.label);
        expect(labels).toEqual([
            'game.tactics.menu.continue',
            'game.tactics.menu.quickMatch',
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

    it('"Continue" resumes through the engine verb, naming no save slot of its own', () => {
        const btn = findButton('game.tactics.menu.continue');
        expect(btn.action).toStrictEqual({ type: 'continue' });
    });

    it('"Quick Match" starts host-vs-one-AI and declares nothing else', () => {
        const btn = findButton('game.tactics.menu.quickMatch');
        // toStrictEqual, not toEqual: an explicitly `undefined` gameParams /
        // localSeats / hostAttributes key would satisfy toEqual against this
        // literal, and the claim here is that the button declares NONE of them —
        // one AI seat with no attributes, every other field the game's own.
        expect(btn.action).toStrictEqual({
            type: 'start-game',
            config: { aiSeats: [{}] },
        });
    });
});

// ─── Test-id slugs ────────────────────────────────────────────────────────────
//
// `GameMainMenuButton.id` is the slug the engine renders as `main-menu-<id>`.
// The engine derives one from the action for every entry it can name, so an
// entry declares `id` only where that derivation cannot: `start-game` derives
// `main-menu-start`, which says nothing about WHICH start this is once a game
// declares more than one. `continue` needs none — the engine's own derivation
// already names it `main-menu-continue`. Both testids are cross-checked against
// the POM in `apps/tactics/e2e/pages/MainMenuPage.testid-alignment.test.ts`.

describe('button test-id slugs', () => {
    function findButton(label: string) {
        const btn = tacticsMainMenuDefinition.buttons.find((b) => b.label === label);
        if (!btn) throw new Error(`Button "${label}" not found`);
        return btn;
    }

    it('names "Quick Match" explicitly, because the action derives only main-menu-start', () => {
        expect(findButton('game.tactics.menu.quickMatch').id).toBe('quick-match');
    });

    it('leaves "Continue" to the engine derivation', () => {
        expect(findButton('game.tactics.menu.continue').id).toBeUndefined();
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

    it('gives every match entry the primary variant (§4.37.2 — game start)', () => {
        expect(findButton('game.tactics.menu.continue').variant).toBe('primary');
        expect(findButton('game.tactics.menu.quickMatch').variant).toBe('primary');
        expect(findButton('game.tactics.menu.newGame').variant).toBe('primary');
    });
});

// ─── Replays button availability check ──────────────────────────────────────
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

// ─── Confirmation ─────────────────────────────────────────────────────────────

describe('button confirmations', () => {
    it('asks before nothing: no entry declares a confirm dialog', () => {
        // Neither entry declares one, which is what the issue specified. Note
        // this is NOT the same as "neither could want one": the game keeps a
        // single autosave slot, and the match Quick Match opens rewrites it on
        // its first accepted end-turn, so a player holding a Continue point
        // loses it without being asked. `confirm.when: 'autosave-exists'`
        // exists for exactly that case (§4.37.5); whether to spend it here is a
        // UX call left open rather than answered by this assertion.
        const withConfirm = tacticsMainMenuDefinition.buttons
            .filter((b) => b.confirm !== undefined)
            .map((b) => b.label);
        expect(withConfirm).toEqual([]);
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
