'use client';

import { useEffect, useRef } from 'react';
import type { GameEvent } from '@chimera-engine/simulation/bridge/api-types.js';

import type { EventAudioBinding } from '../../audio/EventAudioBinding.js';
import { useAudioManager } from '../../audio/AudioManagerContext.js';
import { useGameStore } from '../../state/gameStore.js';

/**
 * One entry's resolved per-occurrence overrides, every member present and
 * possibly `undefined` so the merge below can `??` uniformly. `rate` is
 * deliberately not read out: nothing in the play options consumes it yet, and
 * forwarding it as an excess property would ship an unvalidated field the day
 * they grow one.
 */
interface ResolvedEventOverrides {
    readonly bus: 'master' | 'music' | 'sfx' | 'voice' | undefined;
    readonly volume: number | undefined;
    readonly priority: number | undefined;
}

const NO_OVERRIDES: ResolvedEventOverrides = {
    bus: undefined,
    volume: undefined,
    priority: undefined,
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
        const { bus, volume, priority } = resolver(event);
        return { bus, volume, priority };
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
    const playedEventCountRef = useRef(events.length);

    useEffect(() => {
        const previousEventCount = playedEventCountRef.current;
        const firstUnplayedEventIndex = events.length < previousEventCount ? 0 : previousEventCount;
        playedEventCountRef.current = events.length;

        for (
            let eventIndex = firstUnplayedEventIndex;
            eventIndex < events.length;
            eventIndex += 1
        ) {
            const event = events[eventIndex];
            if (event === undefined) {
                continue;
            }

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
            audioManager.play(entry.ref, {
                ...(bus === undefined ? {} : { bus }),
                ...(volume === undefined ? {} : { volume }),
                ...(priority === undefined ? {} : { priority }),
            });
        }
    }, [audioManager, binding, events]);

    return null;
}
