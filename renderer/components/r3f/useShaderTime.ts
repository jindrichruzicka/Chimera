'use client';

/**
 * renderer/components/r3f/useShaderTime.ts
 *
 * The supported shader time uniform: engine time in, a stable `{ value }` a
 * game hands straight to a material.
 *
 * Feature reference: F105 — Sprite Appearance & Custom-Shader Seam.
 *
 * **Why a helper rather than a documented snippet.** The obvious hand-rolled
 * version — accumulate `delta`, or read the R3F clock — works perfectly until
 * the player enables slow motion, and then runs at full speed while everything
 * around it crawls. That is the worst possible moment to discover the wiring was
 * wrong, and it is invisible in every test a game would think to write. So the
 * dilation is applied here, once, rather than left to each call site.
 *
 * **What paces it.** The delta the frame loop hands over, multiplied by
 * `useAnimationTimeScale` — the same opt-in seam every hand-animated thing uses.
 * Nothing here reads a wall clock or a tick: a capped loop
 * delivers fewer, larger deltas and their sum over a second is the same second,
 * so a 30 fps game and a 144 fps one reach the same value.
 *
 * **Why the uniform is allocated lazily into a ref.** It must be the SAME object
 * for the life of the mount — the material keeps the reference it was handed on
 * the first render, so a hook that produced a new object would leave the shader
 * reading one while the loop wrote into another, and the uniform would simply
 * never advance. That identity is what the tests pin.
 *
 * `useMemo` is NOT the same thing, and the difference is not identity: measured
 * against React 19.2.5, StrictMode double-invokes a memo factory but hands both
 * render passes the same memoised object, so a `useMemo` version would satisfy
 * every identity assertion in `useShaderTime.test.tsx`. What rules it out is that a memo is a
 * CACHE React is permitted to discard — a recomputed factory would hand the
 * material a new object mid-session, and the shader it had already been given
 * would stop advancing. A ref is storage rather than a cache. The extra factory
 * invocation under StrictMode is a wasted object rather than a leak, since a
 * uniform owns nothing to dispose; that is the whole difference from
 * `AnimatedSprite`'s quad, which does.
 *
 * **It gates nothing authoritative.** Same discipline as Invariants #132
 * (animation marks) and #135 (audio cues): a value derived from the frame clock
 * is derived from a clock no two machines share, so it is renderer-only
 * feedback. That is held by the SHAPE — the hook takes no parameters, so there
 * is no dispatcher, `SendAction`, `PlayerId` or tick to pass it, and a parameter
 * that does not exist cannot be `eslint-disable`d back in. A frame delta is also
 * not a tick source and nothing here reaches a reducer (Invariants #42, #43).
 */

import { useRef } from 'react';

import { useFrame } from '@react-three/fiber';

import { useAnimationTimeScale } from '../../animation/useAnimationTimeScale.js';

/**
 * A shader uniform holding engine seconds.
 *
 * Structurally `three`'s `IUniform<number>`, so it is assignable straight into a
 * `ShaderMaterial`'s `uniforms` without the game naming a `three` type.
 */
export interface ShaderTimeUniform {
    /** Dilated engine seconds since the component mounted. */
    value: number;
}

/**
 * Engine seconds for a shader, dilating with the match.
 *
 * Must be called inside a `<GameCanvas>`: it subscribes to the frame loop.
 *
 * ```tsx
 * const time = useShaderTime();
 * // …later, in the same component's material:
 * uniforms={{ uTime: time }}
 * ```
 *
 * The object identity is stable for the life of the mount, which is what lets a
 * material hold it. Ownership of anything the GAME allocates around it — a
 * `ShaderMaterial`, its uniforms object — stays the game's: the component that
 * creates one disposes it.
 */
export function useShaderTime(): ShaderTimeUniform {
    const timeScale = useAnimationTimeScale();

    // Lazily seeded rather than `useRef({ value: 0 })`, which would build a
    // throwaway object on every render.
    const uniformRef = useRef<ShaderTimeUniform | null>(null);
    uniformRef.current ??= { value: 0 };
    const uniform = uniformRef.current;

    useFrame((_state, delta) => {
        uniform.value += delta * timeScale;
    });

    return uniform;
}
