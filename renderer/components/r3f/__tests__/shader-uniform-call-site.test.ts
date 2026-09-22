/**
 * renderer/components/r3f/__tests__/shader-uniform-call-site.test.ts
 *
 * Where `useShaderTime`'s uniform has to LAND for a shader to read it.
 *
 * `useShaderTime` advances `value` inside the frame loop and never re-renders —
 * that is the point of it. So everything depends on the material holding the very
 * object the hook returned: a material holding a copy reads the number that copy
 * was made with, forever, and the failure is silent. The hook's own tests pin
 * identity as the hook HANDS IT OUT; nothing pinned what happens to it at the
 * call site, and the two are not the same claim.
 *
 * The first case measures `three`: a `ShaderMaterial` built with a uniforms
 * object stores it by reference. The other two exercise `@react-three/fiber`'s
 * own `applyProps` directly rather than rendering, because what they measure is
 * r3f's behaviour, not React's. The file therefore does NOT mock
 * `@react-three/fiber` — the sibling `useShaderTime.test.tsx` does, which is why
 * these cannot live there. What `AnimatedSprite` does with the resulting
 * `<primitive>` is pinned in `AnimatedSprite.test.tsx`.
 *
 * **Why both modules are `require`d.** r3f's uniforms branch is guarded by
 * `root instanceof THREE.ShaderMaterial`, and under vitest the vite-transformed
 * ESM `three` is a DIFFERENT module instance from the CJS `three` that CJS-built
 * r3f requires — measured: `esmThree.ShaderMaterial !== cjsThree.ShaderMaterial`.
 * A material built from the ESM copy fails that `instanceof`, r3f falls to its
 * plain-assignment arm, and every case here would pass while measuring a code
 * path no application ever takes. Resolving both from one instance is what makes
 * these measure the shipped behaviour.
 */

import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import type * as FiberModule from '@react-three/fiber';
import type * as ThreeModule from 'three';

import type { ShaderTimeUniform } from '../useShaderTime.js';

const require_ = createRequire(import.meta.url);
const { ShaderMaterial } = require_('three') as typeof ThreeModule;
const { applyProps } = require_('@react-three/fiber') as typeof FiberModule;

describe('a shader time uniform reaches the material only on the owned-instance path', () => {
    it('keeps the uniform’s identity when the game constructs the material itself', () => {
        // The documented path's first half: the game builds the `ShaderMaterial`,
        // seating the uniform in its constructor, and `three` stores the uniforms
        // object by reference. The second half — that `AnimatedSprite` declines to
        // write into an element carrying an `object`, so nothing replaces it — is
        // pinned in `AnimatedSprite.test.tsx`.
        const uniform: ShaderTimeUniform = { value: 0 };
        const material = new ShaderMaterial({ uniforms: { uTime: uniform } });

        uniform.value = 42;

        expect(material.uniforms['uTime']).toBe(uniform);
        expect(material.uniforms['uTime']?.value).toBe(42);
    });

    it('does NOT keep it when `uniforms` is declared as a JSX prop', () => {
        // Measured against @react-three/fiber 9.6.1: `applyProps` special-cases
        // `ShaderMaterial` + `uniforms`, and for a uniform the material does not
        // ALREADY carry it stores a shallow copy. A fresh material carries none,
        // so the copy is what it keeps — and it reads 0 for the life of the mount
        // while the hook advances an object nothing is looking at.
        //
        // This case is also the control for the one above: it can only pass if
        // r3f's `instanceof ShaderMaterial` branch is genuinely being taken, so a
        // duplicate `three` instance in the module graph reds it rather than
        // quietly making both cases agree.
        const uniform: ShaderTimeUniform = { value: 0 };
        const material = new ShaderMaterial();

        applyProps(material as never, { uniforms: { uTime: uniform } });
        uniform.value = 42;

        expect(material.uniforms['uTime']).not.toBe(uniform);
        expect(material.uniforms['uTime']?.value).toBe(0);
    });

    it('copies one stale sample on a later re-render, then freezes again', () => {
        // Why the JSX path is not merely "slow to start". A re-render for any
        // unrelated reason runs the `Object.assign` arm, so the shader jumps to
        // whatever the value happened to be at that instant and stops again.
        const uniform: ShaderTimeUniform = { value: 0 };
        const material = new ShaderMaterial();

        applyProps(material as never, { uniforms: { uTime: uniform } });
        uniform.value = 42;
        applyProps(material as never, { uniforms: { uTime: uniform } });

        expect(material.uniforms['uTime']?.value).toBe(42);

        uniform.value = 99;
        expect(material.uniforms['uTime']?.value).toBe(42);
    });
});
