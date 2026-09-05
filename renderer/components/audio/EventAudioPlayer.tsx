'use client';

import { useEffect, useRef } from 'react';
import type { GameEvent } from '@chimera-engine/simulation/bridge/api-types.js';

import type { EventAudioBinding } from '../../audio/EventAudioBinding.js';
import { useAudioManager } from '../../audio/AudioManagerContext.js';
import { useGameStore } from '../../state/gameStore.js';

/**
 * One entry's resolved per-occurrence overrides, every member present and
 * possibly `undefined` so the merge below can `??` uniformly.
 */
interface ResolvedEventOverrides {
    readonly bus: 'master' | 'music' | 'sfx' | 'voice' | undefined;
    readonly volume: number | undefined;
    readonly priority: number | undefined;
    readonly rate: number | undefined;
}

const NO_OVERRIDES: ResolvedEventOverrides = {
    bus: undefined,
    volume: undefined,
    priority: undefined,
    rate: undefined,
};

/**
 * Run one entry's options resolver for one event occurrence, containing it: a
 * resolver that throws (or returns something unreadable) must not abort the batch
 * for the remaining events, so it warns once and the entry's static fields play.
 */
function resolveEventOverrides(
    entry: NonNullable<EventAudioBinding[string]>,
    event: GameEvent,
): ResolvedEventOverrides {
    const resolver = entry.options;
    if (resolver === undefined) {
        return NO_OVERRIDES;
    }

    try {
        const { bus, volume, priority, rate } = resolver(event);
        return { bus, volume, priority, rate };
    } catch {
        console.warn(
            `Audio event options resolver for '${event.type}' threw; playing the static binding entry instead.`,
        );
        return NO_OVERRIDES;
    }
}

export interface EventAudioPlayerProps {
    readonly binding: EventAudioBinding;
}

const EMPTY_EVENTS: readonly GameEvent[] = [];

export function EventAudioPlayer({ binding }: EventAudioPlayerProps): null {
    const audioManager = useAudioManager();
    const events = useGameStore((state) => state.snapshot?.events ?? EMPTY_EVENTS);
    // `snapshot.events` is a per-ACTION outbox (§4.2): every snapshot carries
    // the events of one applied action and nothing older, so a batch is played
    // WHOLE — there is no already-heard prefix to index past, and a played
    // COUNT would silently drop a batch that happens to be no longer than the
    // one before it.
    //
    // What the ref still does is identity: the effect also re-runs when the
    // `binding` prop or the audio manager changes identity, and neither hands
    // it a new batch. Seeded with the mount-time array so events already on the
    // snapshot when this player mounts are not replayed.
    const playedEventsRef = useRef<readonly GameEvent[]>(events);

    useEffect(() => {
        if (playedEventsRef.current === events) {
            return;
        }
        playedEventsRef.current = events;

        for (const event of events) {
            const entry = binding[event.type];
            if (entry === undefined) {
                continue;
            }

            // Resolver output merges OVER the static fields: an omitted key leaves
            // the static value in place, and an entry with no resolver produces the
            // identical call it always has.
            const overrides = resolveEventOverrides(entry, event);
            const bus = overrides.bus ?? entry.bus;
            const volume = overrides.volume ?? entry.volume;
            const priority = overrides.priority;
            // `priority` and `rate` have no static field to fall back to: the
            // resolver is the only author of either, and an omitted one stays
            // ABSENT rather than becoming an explicit `undefined`.
            const rate = overrides.rate;
            audioManager.play(entry.ref, {
                ...(bus === undefined ? {} : { bus }),
                ...(volume === undefined ? {} : { volume }),
                ...(priority === undefined ? {} : { priority }),
                ...(rate === undefined ? {} : { rate }),
            });
        }
    }, [audioManager, binding, events]);

    return null;
}
