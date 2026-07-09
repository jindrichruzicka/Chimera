// renderer/components/ui/useExitPresence.ts
//
// Keeps an overlay mounted after `open` flips false until its CSS exit
// animations finish, so Modal/Drawer can play close animations without any
// public API change. Where no exit animation is computable — jsdom, or
// `prefers-reduced-motion` collapsing the `--ch-*` duration tokens to 0ms —
// the unmount happens synchronously in the same commit, preserving the
// "close is instant" contract existing tests rely on.

import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Grace period past the longest computed exit animation before force-unmount. */
const EXIT_SAFETY_BUFFER_MS = 100;

type ExitPresencePhase = 'open' | 'closing' | 'closed';

export interface ExitPresence {
    /** Render the overlay while true (covers both open and closing). */
    readonly mounted: boolean;
    /** True only while the exit animation is playing. */
    readonly closing: boolean;
}

function parseCssTimeToMs(value: string): number {
    const trimmed = value.trim();
    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed)) return 0;
    return trimmed.endsWith('ms') ? parsed : parsed * 1000;
}

/**
 * Longest `duration + delay` across the element's computed animations.
 * Per CSS animation semantics a shorter `animation-delay` list cycles to
 * cover the `animation-name` list.
 */
function exitAnimationTotalMs(element: HTMLElement): number {
    const style = window.getComputedStyle(element);
    const durations = style.animationDuration.split(',').map(parseCssTimeToMs);
    const delays = style.animationDelay.split(',').map(parseCssTimeToMs);

    return durations.reduce(
        (max, duration, index) => Math.max(max, duration + (delays[index % delays.length] ?? 0)),
        0,
    );
}

/**
 * Delayed-unmount presence for animated overlays.
 *
 * Each ref in `animatedElementRefs` whose computed exit animation is longer
 * than 0ms must fire its own `animationend` before the overlay unmounts (a
 * game may retime the backdrop and panel independently, so one shared
 * listener would unmount early); a safety timer of the longest total plus a
 * buffer covers swallowed events. Reopening mid-close returns to the open
 * state and cancels the pending unmount.
 */
export function useExitPresence(
    open: boolean,
    animatedElementRefs: readonly RefObject<HTMLElement | null>[],
): ExitPresence {
    const [phase, setPhase] = useState<ExitPresencePhase>(open ? 'open' : 'closed');
    const refsRef = useRef(animatedElementRefs);
    refsRef.current = animatedElementRefs;

    // Derived-state adjustment during render (not an effect): reopening must
    // win immediately so a mid-close reopen never flashes unmounted, and the
    // open → closing hand-off lands in the same flush as the caller's state
    // change so the exit animation starts on the very next paint.
    if (open && phase !== 'open') {
        setPhase('open');
    } else if (!open && phase === 'open') {
        setPhase('closing');
    }

    useLayoutEffect(() => {
        if (phase !== 'closing') return undefined;

        const pending = new Set<HTMLElement>();
        let longestTotalMs = 0;
        for (const ref of refsRef.current) {
            const element = ref.current;
            if (element === null) continue;
            const totalMs = exitAnimationTotalMs(element);
            if (totalMs > 0) {
                pending.add(element);
                longestTotalMs = Math.max(longestTotalMs, totalMs);
            }
        }

        // No computable exit animation (jsdom, reduced motion, 0ms override):
        // unmount synchronously within this commit.
        if (pending.size === 0) {
            setPhase('closed');
            return undefined;
        }

        const removeListeners: (() => void)[] = [];
        for (const element of pending) {
            const handleAnimationEnd = (event: AnimationEvent): void => {
                // Ignore animationend bubbling up from descendants.
                if (event.target !== element) return;
                pending.delete(element);
                if (pending.size === 0) setPhase('closed');
            };
            element.addEventListener('animationend', handleAnimationEnd);
            removeListeners.push(() =>
                element.removeEventListener('animationend', handleAnimationEnd),
            );
        }

        const safetyTimer = setTimeout(
            () => setPhase('closed'),
            longestTotalMs + EXIT_SAFETY_BUFFER_MS,
        );

        return () => {
            clearTimeout(safetyTimer);
            for (const removeListener of removeListeners) removeListener();
        };
    }, [phase]);

    return { mounted: phase !== 'closed', closing: phase === 'closing' };
}
