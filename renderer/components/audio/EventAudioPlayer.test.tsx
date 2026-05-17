// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';

import { AudioManagerContext } from '../../audio/AudioManagerContext.js';
import type { EventAudioBinding } from '../../audio/EventAudioBinding.js';
import { createAudioManagerSpy } from '../../audio/__test-support__/AudioManagerStubs.js';
import { useGameStore } from '../../state/gameStore.js';
import { EventAudioPlayer } from './EventAudioPlayer.js';

const LOCAL_PLAYER = playerId('p1');
const HIT_REF = 'tactics/audio/sfx/hit.ogg' as AssetRef<AudioClipAsset>;
const WIN_REF = 'tactics/audio/sfx/win.ogg' as AssetRef<AudioClipAsset>;

beforeEach(() => {
    useGameStore.getState().applySnapshot(makeSnapshot());
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useGameStore.getState().applySnapshot(makeSnapshot());
});

describe('EventAudioPlayer', () => {
    it('plays matching game events through the injected audio manager', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF, bus: 'sfx', volume: 0.5 },
            'match:won': { ref: WIN_REF, bus: 'voice' },
        };

        renderPlayer(binding, audioManager);
        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 2,
                events: [{ type: 'combat:hit' }, { type: 'match:won' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(2));
        expect(audioManager.play).toHaveBeenNthCalledWith(1, HIT_REF, {
            bus: 'sfx',
            volume: 0.5,
        });
        expect(audioManager.play).toHaveBeenNthCalledWith(2, WIN_REF, { bus: 'voice' });
    });

    it('ignores events with no binding entry', async () => {
        const audioManager = createAudioManagerSpy();

        renderPlayer({ 'combat:hit': { ref: HIT_REF } }, audioManager);
        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 2,
                events: [{ type: 'unknown:event' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).not.toHaveBeenCalled());
    });

    it('does not replay when rerendered with the same event array and binding', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = { 'combat:hit': { ref: HIT_REF } };
        const events = [{ type: 'combat:hit' }];

        const { rerender } = renderPlayer(binding, audioManager);
        useGameStore.getState().applySnapshot(makeSnapshot({ tick: 2, events }));
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));

        rerender(wrapPlayer(binding, audioManager));

        expect(audioManager.play).toHaveBeenCalledTimes(1);
    });

    it('does not play events that were already present before mount', async () => {
        const audioManager = createAudioManagerSpy();
        useGameStore.getState().applySnapshot(
            makeSnapshot({
                events: [{ type: 'combat:hit' }],
            }),
        );

        renderPlayer({ 'combat:hit': { ref: HIT_REF } }, audioManager);

        await waitFor(() => expect(audioManager.play).not.toHaveBeenCalled());
    });

    it('plays only events appended since the previous snapshot', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF },
            'match:won': { ref: WIN_REF },
        };
        const firstEvent = { type: 'combat:hit' };

        renderPlayer(binding, audioManager);
        useGameStore.getState().applySnapshot(makeSnapshot({ tick: 2, events: [firstEvent] }));
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));

        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 3,
                events: [firstEvent, { type: 'match:won' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(2));
        expect(audioManager.play).toHaveBeenLastCalledWith(WIN_REF, {});
    });

    it('restarts playback indexing when the snapshot event list shrinks', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF },
            'match:won': { ref: WIN_REF },
        };

        renderPlayer(binding, audioManager);
        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 2,
                events: [{ type: 'combat:hit' }, { type: 'match:won' }],
            }),
        );
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(2));

        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 3,
                events: [{ type: 'match:won' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(3));
        expect(audioManager.play).toHaveBeenNthCalledWith(3, WIN_REF, {});
    });
});

function renderPlayer(
    binding: EventAudioBinding,
    audioManager: ReturnType<typeof createAudioManagerSpy>,
): ReturnType<typeof render> {
    return render(wrapPlayer(binding, audioManager));
}

function wrapPlayer(
    binding: EventAudioBinding,
    audioManager: ReturnType<typeof createAudioManagerSpy>,
): React.ReactElement {
    return (
        <AudioManagerContext.Provider value={audioManager}>
            <EventAudioPlayer binding={binding} />
        </AudioManagerContext.Provider>
    );
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 1,
        viewerId: LOCAL_PLAYER,
        players: { [LOCAL_PLAYER]: { id: LOCAL_PLAYER } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}
