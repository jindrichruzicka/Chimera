// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

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

    it('plays the WHOLE batch, not only what is new since the previous snapshot', async () => {
        // `snapshot.events` is a per-action outbox (§4.2): every snapshot
        // carries one action's events and nothing older, so there is no
        // "already played" prefix to skip. A player that indexed from the
        // previous batch's length would play `match:won` alone here.
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF },
            'match:won': { ref: WIN_REF },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));

        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 3,
                events: [{ type: 'combat:hit' }, { type: 'match:won' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(3));
        expect(audioManager.play).toHaveBeenNthCalledWith(2, HIT_REF, {});
        expect(audioManager.play).toHaveBeenNthCalledWith(3, WIN_REF, {});
    });

    it('plays a new batch that is the SAME LENGTH as the one before it', async () => {
        // The drop a played-count ref produces once the outbox is drained per
        // action: two consecutive one-event batches leave the count at 1 both
        // times, so the second batch is silently skipped.
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF },
            'match:won': { ref: WIN_REF },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));

        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 3, events: [{ type: 'match:won' }] }));

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(2));
        expect(audioManager.play).toHaveBeenNthCalledWith(2, WIN_REF, {});
    });

    it('does not replay the current batch when only the binding identity changes', async () => {
        // A game that passes an inline binding literal re-renders this player
        // with a fresh `binding` on every parent render. The effect re-runs;
        // the batch must not be heard twice.
        const audioManager = createAudioManagerSpy();
        const events = [{ type: 'combat:hit' }];

        const { rerender } = renderPlayer({ 'combat:hit': { ref: HIT_REF } }, audioManager);
        useGameStore.getState().applySnapshot(makeSnapshot({ tick: 2, events }));
        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));

        rerender(wrapPlayer({ 'combat:hit': { ref: HIT_REF } }, audioManager));

        expect(audioManager.play).toHaveBeenCalledTimes(1);
    });

    it('merges resolver output over the static fields, leaving omitted keys static', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': {
                ref: HIT_REF,
                bus: 'sfx',
                volume: 0.5,
                options: () => ({ volume: 0.9, priority: 7 }),
            },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));
        // The resolver's volume wins over the static 0.5, its priority arrives at all
        // (the static entry has no such field), and the bus it OMITTED stays static.
        expect(audioManager.play).toHaveBeenCalledWith(HIT_REF, {
            bus: 'sfx',
            volume: 0.9,
            priority: 7,
        });
    });

    it('lets the resolver move the bus while the static volume stands', async () => {
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': {
                ref: HIT_REF,
                bus: 'sfx',
                volume: 0.5,
                options: () => ({ bus: 'voice' }),
            },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));
        expect(audioManager.play).toHaveBeenCalledWith(HIT_REF, { bus: 'voice', volume: 0.5 });
    });

    it("invokes the resolver once per occurrence with that occurrence's event", async () => {
        const audioManager = createAudioManagerSpy();
        const resolver = vi.fn(() => ({}));
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF, options: resolver },
            'match:won': { ref: WIN_REF },
        };

        // The batch HEAD deliberately has a different type from the resolver's
        // entry: a player that hands every resolver the batch's first event — instead
        // of each occurrence's own — would pass a fixture whose head shares the type.
        renderPlayer(binding, audioManager);
        useGameStore.getState().applySnapshot(
            makeSnapshot({
                tick: 2,
                events: [{ type: 'match:won' }, { type: 'combat:hit' }, { type: 'combat:hit' }],
            }),
        );

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(3));
        // Once per OCCURRENCE of its own entry's event — not per batch, not for the
        // other entry's event.
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(resolver).toHaveBeenNthCalledWith(1, { type: 'combat:hit' });
        expect(resolver).toHaveBeenNthCalledWith(2, { type: 'combat:hit' });
    });

    it('contains a throwing resolver: one warning, static fallback, the batch still plays', async () => {
        const audioManager = createAudioManagerSpy();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const binding: EventAudioBinding = {
            'combat:hit': {
                ref: HIT_REF,
                bus: 'sfx',
                volume: 0.5,
                options: () => {
                    throw new Error('resolver exploded');
                },
            },
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
        expect(audioManager.play).toHaveBeenNthCalledWith(1, HIT_REF, {
            bus: 'sfx',
            volume: 0.5,
        });
        expect(audioManager.play).toHaveBeenNthCalledWith(2, WIN_REF, {});
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('forwards the rate override unchanged into play options', async () => {
        // UNCHANGED is the load-bearing half: the exact-argument assert pins the
        // value the resolver returned, so the player cannot be jittering, scaling
        // or defaulting the rate on the way through. Per-play variation is the
        // game's to author, and this is where the player's half of that is
        // measured rather than asserted.
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': {
                ref: HIT_REF,
                options: () => ({ rate: 1.5, volume: 0.4 }),
            },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));
        expect(audioManager.play).toHaveBeenCalledWith(HIT_REF, { volume: 0.4, rate: 1.5 });
    });

    it('adds no rate of its own when the resolver omits one', async () => {
        // The other fork of the same merge: `rate` has no static field to fall back
        // to, so the player must neither invent one nor pass the key at all.
        //
        // The key set is asserted separately because `toHaveBeenCalledWith` compares
        // with `toEqual` semantics, under which `{ volume }` and
        // `{ volume, rate: undefined }` are the same object — so the argument assert
        // alone catches a substituted rate and not a spread-always one. (`tsc` does
        // catch that one, under `exactOptionalPropertyTypes`; this makes the claim
        // the test's own.)
        const audioManager = createAudioManagerSpy();
        const binding: EventAudioBinding = {
            'combat:hit': { ref: HIT_REF, options: () => ({ volume: 0.4 }) },
        };

        renderPlayer(binding, audioManager);
        useGameStore
            .getState()
            .applySnapshot(makeSnapshot({ tick: 2, events: [{ type: 'combat:hit' }] }));

        await waitFor(() => expect(audioManager.play).toHaveBeenCalledTimes(1));
        expect(audioManager.play).toHaveBeenCalledWith(HIT_REF, { volume: 0.4 });
        expect(Object.keys(vi.mocked(audioManager.play).mock.calls[0]?.[1] ?? {})).toEqual([
            'volume',
        ]);
    });

    it('plays a SHORTER batch whole', async () => {
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
