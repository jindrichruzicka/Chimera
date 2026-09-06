'use client';

/**
 * renderer/components/r3f/useEntityInterpolation.ts
 *
 * Smooths an entity between two AUTHORITATIVE positions.
 *
 * A game whose entities live on a unit grid advances them a whole cell per
 * beat, so an entity driven straight from the snapshot teleports one cell at a
 * time: ten visible steps a second at a 100 ms beat, and a diagonal step
 * covering √2 world units at once. This hook draws the move instead of the
 * arrival.
 *
 * ## The one-beat presentation delay
 *
 * What it shows is where the entity was between the PREVIOUS authoritative
 * position and the current one, so the picture trails the host by up to one
 * beat. That is the standard price of interpolation and it is not adjustable
 * here: the alternative is extrapolating past the newest snapshot, which
 * invents positions the simulation never produced and has to take them back
 * when it guesses wrong. Anything that must agree with the host — hit testing
 * against gameplay state, a rule, an assertion — reads the snapshot, never the
 * interpolated transform.
 *
 * ## Presentation only
 *
 * The smoothed position is a plain `number` and it lives only here. It is never
 * put in an action payload, where Invariant #75 allows no `number` for a
 * fractional gameplay quantity, and it never reaches the snapshot, where
 * Invariant #44 requires an integer or a fixed-point representation.
 *
 * Architecture reference: §4.21 — Curves, Tweening & Interaction
 */

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { Object3D } from 'three';
import { easeOut, lerp } from '../../utils/curves.js';
import type { Vector3Tuple } from '../../types/r3f-types.js';

export interface EntityInterpolationOptions {
    /**
     * Which entity this is. A CHANGE snaps rather than slides: one mounted
     * component may be reused for a different entity, and tweening across that
     * swap would draw a move between two different things.
     */
    readonly entityId: string;
    /** The authoritative world position, straight off the newest snapshot. */
    readonly target: Vector3Tuple;
    /**
     * How long the slide takes — the game's beat period, so the entity arrives
     * about as the next beat lands. Required, because the beat is not something
     * the renderer holds: a game declares its own `tickRateMs`, and a caller
     * passes the same constant its manifest does. A turn-based caller passes a
     * motion duration instead. `0` disables the smoothing and applies each
     * position on arrival.
     */
    readonly durationMs: number;
    /**
     * A move at least this far SNAPS — measured from where the entity is DRAWN
     * to the new target, not from the position it was last told about. A
     * deliberate teleport is not a fast walk, and sliding one draws a path the
     * simulation never took. Absent ⇒ every move slides.
     */
    readonly snapDistance?: number;
}

/**
 * Returns the ref to attach to the object being moved.
 *
 * The caller must NOT also set `position` on that object: this hook owns that
 * transform and writes it for as long as a slide is in flight, and a `position`
 * prop would fight the write on each React commit.
 */
export function useEntityInterpolation(
    options: EntityInterpolationOptions,
): RefObject<Object3D | null> {
    const { entityId, target, durationMs, snapDistance } = options;

    const objectRef = useRef<Object3D>(null);
    // Where the entity is DRAWN, which is not where the snapshot says it is
    // until the slide finishes. Seeded at the first target so a mount — an
    // entity appearing mid-match — starts where it belongs instead of sliding
    // in from the origin.
    const visualRef = useRef<Vector3Tuple>(target);
    const tweenRef = useRef<{
        readonly from: Vector3Tuple;
        readonly to: Vector3Tuple;
        elapsedMs: number;
    } | null>(null);
    const entityIdRef = useRef(entityId);
    const durationMsRef = useRef(durationMs);
    durationMsRef.current = durationMs;
    const targetRef = useRef(target);
    targetRef.current = target;
    // The identity of the CURRENT render, distinct from `entityIdRef`, which
    // holds the one the hook last seeded or snapped for.
    const latestEntityIdRef = useRef(entityId);
    latestEntityIdRef.current = entityId;

    // Whether the object has ever been written. The seeded `visualRef` matches
    // the first target, so without this the mount would take the "nothing
    // moved" arm and leave the object wherever it was constructed — which for
    // an entity appearing mid-match is the origin.
    const appliedRef = useRef(false);

    useLayoutEffect(() => {
        const object = objectRef.current;

        if (!appliedRef.current) {
            // Spent only once the object exists. A caller that attaches the ref
            // on a later commit would otherwise burn the seed on nothing and
            // never come back, leaving the object at the origin — the one thing
            // the seed is here to prevent.
            if (object === null) {
                return;
            }
            appliedRef.current = true;
            entityIdRef.current = entityId;
            snapTo(target, visualRef, tweenRef, object);
            return;
        }
        if (entityIdRef.current !== entityId) {
            entityIdRef.current = entityId;
            snapTo(target, visualRef, tweenRef, object);
            return;
        }
        if (isSamePosition(visualRef.current, target) && tweenRef.current === null) {
            return;
        }
        if (
            durationMsRef.current <= 0 ||
            (snapDistance !== undefined && distance(visualRef.current, target) >= snapDistance)
        ) {
            snapTo(target, visualRef, tweenRef, object);
            return;
        }

        // From where the entity IS, not from the beat it was aiming at: a beat
        // arriving before the previous slide finished must not jump it back to
        // the old cell first.
        tweenRef.current = { from: visualRef.current, to: target, elapsedMs: 0 };
        applyPosition(object, visualRef.current);
        // Keyed on the target's VALUE, never on the array. A caller derives the
        // world position from the snapshot, so it hands over a fresh tuple on
        // every render — and an identity dependency would restart the slide,
        // from wherever it had got to, on any re-render that happened mid-flight.
    }, [entityId, target[0], target[1], target[2], snapDistance]);

    useFrame((state, deltaSeconds) => {
        const object = objectRef.current;
        if (object === null) {
            return;
        }
        if (!appliedRef.current) {
            // The seed's second chance. The layout effect can only take it when
            // the ref is already attached, and it will not run again for a
            // target that has not moved — so a caller that attaches on a later
            // commit is seeded from here instead. It records the identity it
            // seeded with for the same reason the effect's arm does: the id may
            // have moved on while the ref was unattached, and the next effect
            // run compares against this.
            appliedRef.current = true;
            entityIdRef.current = latestEntityIdRef.current;
            snapTo(targetRef.current, visualRef, tweenRef, object);
            return;
        }
        const tween = tweenRef.current;
        if (tween === null) {
            return;
        }

        const elapsedMs = tween.elapsedMs + Math.max(0, deltaSeconds * 1000);
        const durationMsNow = durationMsRef.current;

        if (durationMsNow <= 0 || elapsedMs >= durationMsNow) {
            tweenRef.current = null;
            visualRef.current = tween.to;
            applyPosition(object, tween.to);
            state.invalidate();
            return;
        }

        const progress = easeOut(elapsedMs / durationMsNow);
        const next: Vector3Tuple = [
            lerp(tween.from[0], tween.to[0], progress),
            lerp(tween.from[1], tween.to[1], progress),
            lerp(tween.from[2], tween.to[2], progress),
        ];
        tween.elapsedMs = elapsedMs;
        visualRef.current = next;
        applyPosition(object, next);
        // The correct contract for a `frameloop="demand"` canvas. Inert on the
        // engine's own canvases, for the reason `useTween` states at length.
        state.invalidate();
    });

    return objectRef;
}

function snapTo(
    target: Vector3Tuple,
    visualRef: { current: Vector3Tuple },
    tweenRef: { current: unknown },
    object: Object3D | null,
): void {
    tweenRef.current = null;
    visualRef.current = target;
    applyPosition(object, target);
}

function applyPosition(object: Object3D | null, position: Vector3Tuple): void {
    object?.position.set(position[0], position[1], position[2]);
}

function isSamePosition(a: Vector3Tuple, b: Vector3Tuple): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function distance(a: Vector3Tuple, b: Vector3Tuple): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
