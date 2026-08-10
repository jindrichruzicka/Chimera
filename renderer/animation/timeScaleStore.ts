/**
 * renderer/animation/timeScaleStore.ts
 *
 * The renderer's half of authoritative time dilation: ONE float, the multiplier
 * every clip is paced by. `1` is real time, `0.25` quarter speed.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **The arithmetic is not here.** `setAuthoritativePermille` computes the float
 * through `timeScaleMultiplier` and nothing else, so the host's beat period and
 * this multiplier stay reciprocal by construction: both divide by the same
 * `clampTimeScalePermille` result (Invariant #130). A second formula spelled out
 * here would be a place for a sign or reciprocal error to hide — which is why
 * `timeScaleStore.test.ts` pins that this module's source carries no division
 * and no literal permille scale at all.
 *
 * **Nothing travels back.** The store is written by `TimeScaleBridge` from a
 * snapshot integer and read by the animation layer; no animation state is
 * written into it and none of it enters a `GameSnapshot`, an IPC payload, a save
 * or a replay (Invariant #131).
 *
 * The `perfStore` shape, deliberately: a `createStore` factory for isolation, a
 * singleton hook over it, `getState`/`subscribe` exposed for non-React readers
 * and `setState` withheld so the one typed verb is the only writer (§5.5).
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

import { timeScaleMultiplier } from '@chimera-engine/simulation/foundation/time-scale.js';

export interface TimeScaleStoreState {
    /**
     * The dilation multiplier the animation layer paces against. Real time until
     * an authoritative snapshot says otherwise.
     */
    readonly timeScale: number;

    /**
     * Seat the multiplier for the authoritative `snapshot.timeScalePermille`.
     *
     * Takes the permille verbatim — including `undefined`, which is what an
     * undilated snapshot carries — because the fallback and the clamp are the
     * shared helper's to apply, not the caller's.
     *
     * `this: void` so a component may select it out of the state and hold it —
     * `TimeScaleBridge` does — the way `toastStore` declares its verbs.
     */
    setAuthoritativePermille(this: void, permille: number | undefined): void;
}

/**
 * Create an isolated store instance.
 * Production code uses the singleton `useTimeScaleStore`; tests may use this.
 */
export function createTimeScaleStore(): StoreApi<TimeScaleStoreState> {
    return createStore<TimeScaleStoreState>()((set) => ({
        timeScale: timeScaleMultiplier(undefined),

        setAuthoritativePermille(permille: number | undefined): void {
            set(() => ({ timeScale: timeScaleMultiplier(permille) }));
        },
    }));
}

const timeScaleStoreInstance = createTimeScaleStore();

/**
 * Zustand hook for the time-scale store. Subscribe through a narrow selector
 * (§5.2); `useAnimationTimeScale` is the one production selector.
 *
 * Static accessors are for bootstrap wiring and tests only. `setState` is
 * deliberately not exposed (§5.5): the multiplier has exactly one writer.
 */
export function useTimeScaleStore<T>(selector: (state: TimeScaleStoreState) => T): T {
    return useStore(timeScaleStoreInstance, selector);
}

useTimeScaleStore.getState = timeScaleStoreInstance.getState.bind(timeScaleStoreInstance);
useTimeScaleStore.subscribe = timeScaleStoreInstance.subscribe.bind(timeScaleStoreInstance);
