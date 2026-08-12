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
 * **The texture is never configured here.** It is manager-owned and shared by
 * every sprite cut from the same sheet (Invariant #21), so writing `magFilter`,
 * `colorSpace` or `flipY` on it for one sprite would change all of them.
 * Filtering and color space belong to how the sheet is authored and loaded, not
 * to an element that draws one frame of it.
 *
 * The default material is unlit and untone-mapped, which is what sprite art
 * almost always wants; a game that wants another one passes it as `children`.
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
     * Replaces the default unlit material. The sheet texture is NOT applied to a
     * caller-supplied material — a game that provides one owns its `map` too,
     * because that is the only way it can decide how the sheet is sampled.
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
            {children ?? (
                <meshBasicMaterial map={texture} transparent toneMapped={false} alphaTest={0.01} />
            )}
        </mesh>
    );
}
