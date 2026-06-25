'use client';

import { useEffect, useRef } from 'react';
import type { GameEvent } from '@chimera/simulation/bridge/api-types.js';

import type { EventAudioBinding } from '../../audio/EventAudioBinding.js';
import { useAudioManager } from '../../audio/AudioManagerContext.js';
import { useGameStore } from '../../state/gameStore.js';

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

            audioManager.play(entry.ref, {
                ...(entry.bus === undefined ? {} : { bus: entry.bus }),
                ...(entry.volume === undefined ? {} : { volume: entry.volume }),
            });
        }
    }, [audioManager, binding, events]);

    return null;
}
