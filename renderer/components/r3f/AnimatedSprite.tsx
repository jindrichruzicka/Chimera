'use client';

/**
 * renderer/components/r3f/AnimatedSprite.tsx
 *
 * The sprite half of the animation system as one element: an `AssetRef` to a
 * sprite sheet in, an animated quad out.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why a `Mesh` and not a `THREE.Sprite`.** `Sprite` shares ONE module-level
 * geometry across every instance in the process (measured against three r184:
 * `new Sprite().geometry === new Sprite().geometry`). `SpriteClipBackend` animates
 * by writing that geometry's `uv` attribute, so a `Sprite` would re-cut every
 * sprite in the scene to whatever the last one played. A `Mesh` with its own
 * `PlaneGeometry` is the only shape that gives each sprite a quad of its own.
 * The cost is that the quad is world-oriented rather than camera-facing; a game
 * that wants billboarding rotates the mesh itself.
 *
 * **Why the quad is allocated imperatively.** Declaring `<planeGeometry />`
 * would let R3F build it, but the backend needs a HANDLE to write into, and the
 * ref that would produce it arrives a commit after the hook needs it. Allocating
 * it here is also the StrictMode-safe form: a commit-phase effect, never
 * `useMemo` — which double-invokes and DISCARDS one result, orphaning a geometry
 * with no `dispose` ever running. What this component allocates, it disposes;
 * `useSpriteClipPlayer` never disposes a geometry it was handed.
 *
 * **`PlaneGeometry(1, 1)`'s uv is already the atlas's own order.** Measured:
 * `[0,1] [1,1] [0,0] [1,0]` — top-left, top-right, bottom-left, bottom-right —
 * which is exactly what `SpriteAtlasFrame.uv` carries, so cells are written
 * straight through with no re-derivation. The quad is one world unit square;
 * `scale` sizes it.
 *
 * **The texture is never configured here** (Rule SPRITE-NO-SHARED-MUTATION). It
 * is manager-owned (Invariant #21) and shared by every sprite cut from the same
 * sheet, so writing `magFilter`, `colorSpace` or `flipY` on it for one sprite
 * would change all of them. Filtering and color space belong to how the sheet is
 * authored and loaded — its manifest entry declares them — not to an element
 * that draws one frame of it.
 *
 * The default material is unlit and untone-mapped, which is what sprite art
 * almost always wants; a game that wants another one passes it as `children`,
 * and the default is emitted only when `children` carries no material —
 * `suppliesMaterial` below is where that is decided, and why.
 */

import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { PlaneGeometry } from 'three';
import { PlaneGeometry as ThreePlaneGeometry } from 'three';

import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { useSpriteAnimationSheet } from '../../assets/useAnimationSheet.js';
import { useSpriteAtlas } from '../../assets/useSpriteAtlas.js';
import { useSpriteClipPlayer } from './useSpriteClipPlayer.js';
import type { UseSpriteClipPlayerOptions } from './useSpriteClipPlayer.js';

/** The quad is one world unit square; `scale` is what sizes a sprite. */
const QUAD_SIZE = 1;

/**
 * Which intrinsic names name a material.
 *
 * Exported so the catalogue test measures the pattern the component actually
 * uses; a copy in the test would pin a duplicate of it instead. Not re-exported
 * from the r3f barrel — it is an internal, and the barrel's export list is
 * closed (Invariant #96).
 */
export const MATERIAL_INTRINSIC = /material$/i;

/**
 * Whether an element's `object` prop holds a `three` material.
 *
 * `<primitive>` is what carries one in practice, but this reads `object` off
 * whatever element has it — a component taking a prop of that name lands here
 * too, and answers the same `true` the component arm would.
 */
function isMaterialInstance(object: unknown): boolean {
    return (
        typeof object === 'object' &&
        object !== null &&
        (object as { readonly isMaterial?: unknown }).isMaterial === true
    );
}

/**
 * Whether `children` carries a material, and so replaces the default one.
 *
 * The two ways of being wrong do not cost the same. Answering `true` when no
 * material mounts leaves the mesh on three's implicit white unmapped material —
 * the white square this whole gate exists to prevent. Answering `false` when one
 * does mount emits the default as well, and the caller's material still wins,
 * because `{children}` is rendered after it and the later attach is the one that
 * lands. Each arm below says which way it falls; the component arm is the one
 * that does not fall toward the cheaper mistake, and says why.
 *
 * `attach` decides first and decides BOTH ways. The guard is `!== undefined`
 * rather than a string test, and that is deliberate: it mirrors r3f's own
 * auto-attach condition, which infers from the instantiated object only while
 * `props.attach === undefined`. So ANY defined `attach` — a function the caller
 * assigns by hand as much as a string — suppresses r3f's inference, and must
 * suppress this one. Narrowing the guard to strings would send a function-attach
 * child on to the name arm and put the white square back; there is a fixture on
 * that side of the boundary, not only on the string side.
 *
 * `attach="material"` is then the caller saying what this is — the signal that
 * reaches a material intrinsic registered under another name through `extend()`
 * — and every other `attach` answers `false`, which is the cheap side for all of
 * them.
 *
 * An element carrying a material in `object` — a `<primitive>` — is read as the
 * material, for the bare form that sets no `attach`: the form r3f would itself
 * auto-attach. This runs AFTER `attach` and not before, and the order is the
 * whole of the arm: `<primitive object={depthMaterial} attach="customDepthMaterial"/>`
 * is a material instance that is NOT the mesh's material, and answering from
 * `object` first would put the white square back.
 *
 * A FRAGMENT is looked through, because `<>{material}{label}</>` is a shape a
 * game writes and nothing else in the element says what is inside. No other
 * symbol type is: `Suspense` renders its FALLBACK when suspended (measured
 * against react-dom 19.2.5), so looking through one would claim a material that
 * never mounted.
 *
 * An INTRINSIC is matched on its name, which is sound and complete over three's
 * own catalogue — a third-party property, so `AnimatedSprite.test.tsx` measures
 * it rather than leaving it asserted here.
 *
 * A COMPONENT is read as the material. `<GlowMaterial/>` and an `<Html>` label
 * are both non-string types and neither element says which it is, so this arm
 * answers `true` for a case it cannot decide: it preserves the existing contract
 * at the cost of the white square, because changing it would break every caller
 * already passing a material component.
 */
function suppliesMaterial(children: ReactNode): boolean {
    return React.Children.toArray(children).some((child) => {
        if (!React.isValidElement(child)) {
            return false;
        }

        const {
            attach,
            object,
            children: nested,
        } = child.props as {
            readonly attach?: unknown;
            readonly object?: unknown;
            readonly children?: ReactNode;
        };
        if (attach !== undefined) {
            return attach === 'material';
        }
        if (isMaterialInstance(object)) {
            return true;
        }

        const { type } = child;
        if (type === React.Fragment) {
            return suppliesMaterial(nested);
        }
        if (typeof type === 'string') {
            return MATERIAL_INTRINSIC.test(type);
        }
        // Function and object types (including `memo` and `forwardRef` wrappers)
        // are components; any remaining symbol is a container this does not look
        // through.
        return typeof type !== 'symbol';
    });
}

/** What a game declares on an `<AnimatedSprite>`. */
export interface AnimatedSpriteProps extends UseSpriteClipPlayerOptions {
    /**
     * The sprite sheet to play, or `null` to draw nothing yet. Its manifest
     * entry carries the clip sheet; its atlas descriptor carries the cells.
     */
    readonly sheet: AssetRef<SpriteSheetAsset> | null;
    /** World position of the quad's centre. */
    readonly position?: readonly [number, number, number];
    /** Euler rotation in radians. A billboarding game drives this itself. */
    readonly rotation?: readonly [number, number, number];
    /** Quad size in world units. A scalar scales both axes. */
    readonly scale?: number | readonly [number, number, number];
    /** Draw order for coplanar sprites; forwarded to the mesh. */
    readonly renderOrder?: number;
    /** Whether the mesh is drawn at all. */
    readonly visible?: boolean;
    /**
     * A material here replaces the default unlit one; anything else is drawn as
     * a child alongside it. The sheet texture is NOT applied to a caller-supplied
     * material — a game that provides one owns its `map` too, because that is
     * the only way it can decide how the sheet is sampled.
     *
     * `suppliesMaterial` is what decides which children count as a material,
     * and why each case falls the way it does.
     */
    readonly children?: ReactNode;
}

/**
 * Draw and animate one clip of a sprite sheet.
 *
 * Renders NOTHING until the sheet's texture has decoded. A mesh mounted before
 * then would carry `map={null}` on an opaque material — a white unit square, for
 * as long as the load takes — so the gate is on the texture rather than on the
 * geometry alone. Every authoring fault — a clip the sheet does not carry, a
 * frame run reaching past the atlas, a missing `durationSeconds` — is reported
 * through the log bridge and leaves the sprite still rather than throwing
 * (Invariant #67).
 *
 * A sheet that decodes but measures to no atlas — a sprite sheet loaded straight
 * from an image, with no descriptor to cut cells from — still draws: the quad
 * shows the whole texture and plays nothing, which is what a sheet with one
 * implicit frame IS.
 *
 * Must be mounted inside a `<GameCanvas>` (it drives a frame subscriber) and
 * inside an `AssetManagerProvider` (it resolves an `AssetRef`).
 */
export function AnimatedSprite({
    sheet,
    position,
    rotation,
    scale,
    renderOrder,
    visible,
    children,
    ...playback
}: Readonly<AnimatedSpriteProps>): React.ReactElement | null {
    const { atlas, texture } = useSpriteAtlas(sheet);
    const parsed = useSpriteAnimationSheet(sheet);
    const [geometry, setGeometry] = useState<PlaneGeometry | null>(null);

    // Commit-phase, never `useMemo`: a discarded memo invocation would orphan a
    // geometry with no `dispose` ever running. One quad per mounted component,
    // for the life of that mount — Rule ONE-WRITER-PER-QUAD.
    useEffect(() => {
        const allocated = new ThreePlaneGeometry(QUAD_SIZE, QUAD_SIZE);
        setGeometry(allocated);
        return () => {
            setGeometry(null);
            allocated.dispose();
        };
    }, []);

    // `parsed.sheet` rather than `parsed`: the parsed wrapper carries `warnings`
    // alongside the sheet and is not itself a clip sheet. Both it and `atlas`
    // are memoised by their hooks, which is what keeps them out of the
    // allocation effect's restart path.
    useSpriteClipPlayer(atlas, geometry, parsed?.sheet ?? null, playback);

    // Two arms, killed by two different gates. `texture === null` is the
    // behavioural one — it is what keeps a white unit square off the screen for
    // the length of the load — and a test asserts the rendered output. The
    // `geometry === null` arm is a TYPE gate: `mesh.geometry` takes no `null`,
    // so dropping it reds `tsc` (TS2322) rather than any assertion. Neither is
    // redundant with the other, and neither is reachable-but-unpinned.
    if (geometry === null || texture === null) {
        return null;
    }

    return (
        <mesh
            geometry={geometry}
            {...(position !== undefined ? { position } : {})}
            {...(rotation !== undefined ? { rotation } : {})}
            {...(scale !== undefined ? { scale } : {})}
            {...(renderOrder !== undefined ? { renderOrder } : {})}
            {...(visible !== undefined ? { visible } : {})}
        >
            {!suppliesMaterial(children) && (
                <meshBasicMaterial map={texture} transparent toneMapped={false} alphaTest={0.01} />
            )}
            {children}
        </mesh>
    );
}
