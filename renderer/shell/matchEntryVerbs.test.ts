/**
 * renderer/shell/matchEntryVerbs.test.ts
 *
 * The two match-entry verbs and the transition protocol around them (§4.37.18):
 * ARM before the IPC call so a game's background has the whole fade to move,
 * CLEAR when the call rejects so a refused entry never leaves a background
 * dollied into a match that never came.
 *
 * Tests written first (TDD — red confirmed: the module did not exist).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screenFadeMs } from '../components/shell/screenFadeDuration';
import type { QuickStartParams } from '@chimera-engine/simulation/bridge/api-types.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import { _resetShellStateForTest, getShellState, setShellRoute } from './shellStateStore';
import { continueFromAutosave, startQuickMatch } from './matchEntryVerbs';

const quickStart = vi.fn();
const load = vi.fn();

function installBridge(overrides: Record<string, unknown> = {}): void {
    (globalThis as Record<string, unknown>)['__chimera'] = {
        lobby: { quickStart },
        saves: { load },
        ...overrides,
    };
}

beforeEach(() => {
    _resetShellStateForTest();
    quickStart.mockReset().mockResolvedValue({});
    load.mockReset().mockResolvedValue(undefined);
    installBridge();
});

const params: QuickStartParams = { gameId: 'tactics', gameParams: { mapSize: 'small' } };

describe('startQuickMatch', () => {
    it('issues the quick-start verb with the params it was given', async () => {
        await startQuickMatch(params);

        expect(quickStart).toHaveBeenCalledWith(params);
    });

    it('arms a to-match transition BEFORE the verb is issued, carrying the fade this hop runs on', async () => {
        // The exact value, not `expect.any(Number)`: `durationMs` is a published
        // contract field a background times a dolly-in on, so a 0 there is a
        // background that never moves — and a shape check cannot see it.
        let armedAtCallTime: unknown;
        quickStart.mockImplementation(() => {
            armedAtCallTime = getShellState().transition;
            return Promise.resolve({});
        });

        await startQuickMatch(params);

        expect(armedAtCallTime).toEqual({ kind: 'to-match', durationMs: screenFadeMs() });
        expect(screenFadeMs()).toBeGreaterThan(0);
    });

    it('leaves the transition armed when the verb resolves — the match surface clears it', async () => {
        await startQuickMatch(params);

        expect(getShellState().transition).toMatchObject({ kind: 'to-match' });
    });

    it('clears the armed transition when the IPC rejects', async () => {
        quickStart.mockRejectedValue(new Error('refused'));

        await expect(startQuickMatch(params)).rejects.toThrow('refused');

        expect(getShellState().transition).toBeNull();
    });

    it('throws SYNCHRONOUSLY and clears when the lobby bridge is absent', () => {
        // An absent preload bridge is an engine defect and belongs in the crash
        // fallback, not in a console line — which is what a rejection would make
        // it, since the caller reports a REFUSED start that way.
        (globalThis as Record<string, unknown>)['__chimera'] = {};

        expect(() => startQuickMatch(params)).toThrow('Chimera lobby API not available');

        expect(getShellState().transition).toBeNull();
    });

    it('throws synchronously when the lobby bridge carries no quick-start verb', () => {
        (globalThis as Record<string, unknown>)['__chimera'] = { lobby: {} };

        expect(() => startQuickMatch(params)).toThrow('Chimera lobby API not available');

        expect(getShellState().transition).toBeNull();
    });

    it('leaves an already-published route alone', async () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });

        await startQuickMatch(params);

        expect(getShellState()).toMatchObject({ surface: 'main-menu', gameId: 'tactics' });
    });
});

describe('continueFromAutosave', () => {
    it('loads the autosave slot for the game', async () => {
        await continueFromAutosave('tactics');

        expect(load).toHaveBeenCalledWith(autosaveSlotId('tactics'));
    });

    it('arms a to-match transition BEFORE the load is issued, carrying the fade this hop runs on', async () => {
        let armedAtCallTime: unknown;
        load.mockImplementation(() => {
            armedAtCallTime = getShellState().transition;
            return Promise.resolve();
        });

        await continueFromAutosave('tactics');

        expect(armedAtCallTime).toEqual({ kind: 'to-match', durationMs: screenFadeMs() });
        expect(screenFadeMs()).toBeGreaterThan(0);
    });

    it('clears the armed transition when the load rejects', async () => {
        load.mockRejectedValue(new Error('no such slot'));

        await expect(continueFromAutosave('tactics')).rejects.toThrow('no such slot');

        expect(getShellState().transition).toBeNull();
    });

    it('throws SYNCHRONOUSLY and clears when the saves bridge is absent', () => {
        (globalThis as Record<string, unknown>)['__chimera'] = {};

        expect(() => continueFromAutosave('tactics')).toThrow('Chimera saves API not available');

        expect(getShellState().transition).toBeNull();
    });
});
