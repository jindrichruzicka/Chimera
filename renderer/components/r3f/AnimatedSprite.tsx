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
 * almost always wants. A game that wants another one passes it as `material`,
 * which RECEIVES the sheet texture this component has already resolved, or as
 * `children`, which does not — `withSheetTexture` and `suppliesMaterial` below
 * are where each of those is decided, and why.
 */

import React, { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { Blending, PlaneGeometry } from 'three';
import {
    AdditiveBlending,
    MultiplyBlending,
    NoBlending,
    NormalBlending,
    SubtractiveBlending,
    PlaneGeometry as ThreePlaneGeometry,
} from 'three';

import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { useSpriteAnimationSheet } from '../../assets/useAnimationSheet.js';
import { useSpriteAtlas } from '../../assets/useSpriteAtlas.js';
import type { UseSpriteAtlasState } from '../../assets/useSpriteAtlas.js';
import { useSpriteClipPlayer } from './useSpriteClipPlayer.js';
import type { UseSpriteClipPlayerOptions } from './useSpriteClipPlayer.js';

/** The quad is one world unit square; `scale` is what sizes a sprite. */
const QUAD_SIZE = 1;

/**
 * How a sprite's colour combines with what is already in the frame buffer.
 *
 * Engine-owned names, so a game never imports `three` for a prop value
 * (Invariant #1). `subtractive` and `multiply` darken, `additive` brightens and
 * `none` writes the texel straight through.
 */
export type SpriteBlending = 'normal' | 'additive' | 'subtractive' | 'multiply' | 'none';

/**
 * How a sprite's alpha is resolved.
 *
 * A mode decides exactly two material fields — `transparent`, and the `alphaTest`
 * the sprite gets when it authors no `alphaThreshold`:
 *
 * - `opaque` — not transparent, and no cutout unless one is authored. What
 *   fully-opaque art wants.
 * - `mask` — not transparent, cutting out at `MASK_ALPHA_TEST` by default. What
 *   pixel art almost always wants.
 * - `blend` — transparent, and no cutout unless one is authored. What
 *   soft-edged art wants, at the cost of depth-sorting.
 *
 * Nothing here decides whether the sprite writes depth: that is three's own
 * default, and the `depthWrite` prop overrides it in any mode.
 *
 * Leaving `alphaMode` unset is a FOURTH state none of these three spells — see
 * `resolveAlpha`.
 */
export type SpriteAlphaMode = 'opaque' | 'mask' | 'blend';

/**
 * The engine name → `three` constant table.
 *
 * It lives in this module because `AnimatedSprite` is not on the shell layout
 * graph, which `shell-layout-graph-census.test.ts` walks to forbid a static value
 * edge naming `three` from the always-mounted layout. That, and not the `three`
 * import already here, is what makes the table free.
 */
const SPRITE_BLENDING: Readonly<Record<SpriteBlending, Blending>> = {
    normal: NormalBlending,
    additive: AdditiveBlending,
    subtractive: SubtractiveBlending,
    multiply: MultiplyBlending,
    none: NoBlending,
};

/**
 * The cutout a `mask` sprite gets when the game authors no threshold.
 *
 * A cutout wants a threshold near the middle of the alpha range; the value that
 * makes `mask` mean anything is the whole reason the mode is separate from
 * `blend`.
 */
const MASK_ALPHA_TEST = 0.5;

/**
 * The cutout a sprite that declares no `alphaMode` keeps.
 *
 * This is the pre-existing default, unchanged on purpose: `transparent` together
 * with a 0.01 cutout is a hybrid that is neither `mask` nor `blend`, so no named
 * mode spells it, and whether it is the right default is a separate decision
 * from making the modes expressible. `AnimatedSprite.test.tsx` pins it by value.
 */
const UNSET_MODE_ALPHA_TEST = 0.01;

/**
 * The two material fields an alpha mode decides.
 *
 * `alphaThreshold` is honoured in EVERY mode rather than only in `mask`, because
 * `alphaTest` is meaningful alongside transparency too. Each mode supplies its
 * own default for it, so nothing is a field one mode reads and the others
 * silently ignore. The combination worth knowing about is `blend` with a
 * non-zero threshold: that cuts a hard edge INSIDE a soft-edged sprite, which is
 * rarely what a game means by `blend`.
 */
function resolveAlpha(
    mode: SpriteAlphaMode | undefined,
    threshold: number | undefined,
): { readonly transparent: boolean; readonly alphaTest: number } {
    switch (mode) {
        case 'opaque':
            return { transparent: false, alphaTest: threshold ?? 0 };
        case 'mask':
            return { transparent: false, alphaTest: threshold ?? MASK_ALPHA_TEST };
        case 'blend':
            return { transparent: true, alphaTest: threshold ?? 0 };
        default:
            return { transparent: true, alphaTest: threshold ?? UNSET_MODE_ALPHA_TEST };
    }
}

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
 * Whether ONE element is itself a material.
 *
 * This is the question the `material` prop asks. The children walk below asks a
 * different one — whether a material is anywhere among them — and the two must
 * not be conflated: a fragment CONTAINING a material answers `true` there and
 * `false` here, because handing the sheet texture to a fragment would put it on
 * a container React drops it from and leave the material inside with nothing.
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
function isMaterialElement(node: ReactNode): boolean {
    if (!React.isValidElement(node)) {
        return false;
    }

    const { attach, object } = node.props as {
        readonly attach?: unknown;
        readonly object?: unknown;
    };
    if (attach !== undefined) {
        return attach === 'material';
    }
    if (isMaterialInstance(object)) {
        return true;
    }

    const { type } = node;
    if (typeof type === 'string') {
        return MATERIAL_INTRINSIC.test(type);
    }
    // Function and object types (including `memo` and `forwardRef` wrappers)
    // are components. A symbol type is one of React's own containers, which is
    // not itself a material — a FRAGMENT answers `false` here, and only the
    // children walk below looks inside one.
    return typeof type !== 'symbol';
}

/**
 * Whether `children` carries a material anywhere, and so replaces the default.
 *
 * A FRAGMENT is looked through, because `<>{material}{label}</>` is a shape a
 * game writes. No other container is: `Suspense` renders its FALLBACK when
 * suspended (measured against react-dom 19.2.5), so looking through one would
 * claim a material that never mounted.
 */
function suppliesMaterial(children: ReactNode): boolean {
    return React.Children.toArray(children).some((child) => {
        if (React.isValidElement(child) && child.type === React.Fragment) {
            const { children: nested } = child.props as { readonly children?: ReactNode };
            return suppliesMaterial(nested);
        }
        return isMaterialElement(child);
    });
}

/**
 * The supplied material element, holding the sheet texture.
 *
 * `cloneElement` rather than a write: the element a game handed over may be held
 * in a constant or rendered twice, so this returns a NEW element and leaves the
 * caller's alone. Nothing here touches the TEXTURE either — it is manager-owned
 * and shared by every sprite cut from the sheet (Invariant #21), and handing it
 * to a material is not a licence to configure it.
 *
 * A material whose `map` PROP is set keeps it, `map={null}` included: a game
 * writing `map={maybeTexture}` has said "no map" while its own load is in
 * flight, and overruling that would be this component deciding something the
 * caller already decided. A `map` attached as a CHILD is not visible here — the
 * prop is what this reads.
 *
 * An element whose `object` holds a material INSTANCE — a `<primitive>` —
 * receives nothing at all. r3f would apply the cloned prop by WRITING `map` onto
 * that instance, and the instance belongs to the game: the write would outlive
 * the mount and, if the material is one the asset manager shares, would reach
 * every consumer of it (Invariant #21). A game handing over an instance has
 * already configured it.
 *
 * That test is `isMaterialInstance`, the same one `isMaterialElement` uses, and
 * deliberately not the coarser `object !== undefined`. The two predicates have to
 * agree about what `object` means: a material COMPONENT taking a prop of that
 * name out of a game's own vocabulary counts as the material, so declining it the
 * texture would leave the sprite with neither a mapped material nor a default.
 *
 * Exported so the clone is pinned by element identity rather than through a
 * render: React freezes `element.props` in development, so an in-place write
 * throws before any rendered assertion could observe it, and the pin would be
 * measuring React's freeze instead of this function. Not re-exported from the
 * r3f barrel — the barrel's export list is closed (Invariant #96).
 */
export function withSheetTexture(
    element: ReactElement,
    texture: NonNullable<UseSpriteAtlasState['texture']>,
): ReactElement {
    const { map, object } = element.props as {
        readonly map?: unknown;
        readonly object?: unknown;
    };
    if (map !== undefined || isMaterialInstance(object)) {
        return element;
    }
    return React.cloneElement(element as ReactElement<Record<string, unknown>>, {
        map: texture,
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
     * Tint multiplied into the sheet's texels. A CSS colour string or a packed
     * hex number; the tint lives on this sprite's material, never on the shared
     * sheet texture (Invariant #21).
     */
    readonly color?: string | number;
    /**
     * Sprite-wide alpha multiplier.
     *
     * Only visible where the alpha mode admits transparency. `alphaMode="opaque"`
     * and `"mask"` both resolve to `transparent: false`, and an opacity below 1
     * has nothing to blend against there. It is forwarded verbatim rather than
     * quietly turning transparency on, because an explicit alpha mode a sibling
     * prop could override would not be explicit — which does mean the author who
     * declares a mode is the one this can surprise, and the author who declares
     * none gets a working `opacity` for free.
     */
    readonly opacity?: number;
    /** How this sprite combines with the frame buffer. Absent leaves three's own. */
    readonly blending?: SpriteBlending;
    /**
     * How this sprite's alpha is resolved.
     *
     * Absent is not a synonym for any of the three: it keeps the pre-existing
     * `transparent` plus a small cutout, a hybrid none of them spells. See
     * `SpriteAlphaMode`.
     */
    readonly alphaMode?: SpriteAlphaMode;
    /**
     * The alpha below which a texel is discarded, overruling the mode's own
     * default. Honoured in every mode.
     */
    readonly alphaThreshold?: number;
    /**
     * Whether the sprite writes depth. `false` is what additive sprites almost
     * always want — without it a stack of them occludes itself and the effect
     * collapses.
     */
    readonly depthWrite?: boolean;
    /** Whether the sprite is depth-tested against what is already drawn. */
    readonly depthTest?: boolean;
    /**
     * The material to draw the sprite with, RECEIVING the sheet texture.
     *
     * This is the supported seam for a custom sprite material: the component has
     * already resolved the sheet, so a game that supplies a material here does
     * not resolve it a second time. The element is cloned rather than written
     * into, and `withSheetTexture` is where the precedence is stated: which
     * elements receive the texture, and which the engine declines to touch.
     *
     * Supplying a material here AND as `children` is caller error. Both are
     * emitted, this one first.
     */
    readonly material?: ReactElement;
    /**
     * A material here replaces the default unlit one; anything else is drawn as
     * a child alongside it. The sheet texture is NOT applied to a material
     * supplied this way — it owns its `map` too, which is what the `material`
     * prop exists to spare a game.
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
    color,
    opacity,
    blending,
    alphaMode,
    alphaThreshold,
    depthWrite,
    depthTest,
    material,
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

    const alpha = resolveAlpha(alphaMode, alphaThreshold);

    // ONE binding, read by both consumers below: whether the supplied element is
    // the material decides who gets the texture AND whether the default is
    // emitted, and those two answers must never come from separate calls. Asking
    // twice is what let a fragment be handed the texture while the default was
    // still emitted — two arms of one decision, only one of them pinned.
    const suppliedIsMaterial = material !== undefined && isMaterialElement(material);

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
            {material !== undefined &&
                (suppliedIsMaterial ? withSheetTexture(material, texture) : material)}
            {!suppliedIsMaterial && !suppliesMaterial(children) && (
                // Every appearance prop is spread conditionally rather than
                // passed as `undefined`: an absent prop must leave three's own
                // default standing, and writing `blending={undefined}` would
                // assert a value this component has no opinion about.
                //
                // These configure the DEFAULT material only. A caller who
                // supplies one owns its whole appearance, so nothing here is
                // copied onto it.
                <meshBasicMaterial
                    map={texture}
                    transparent={alpha.transparent}
                    alphaTest={alpha.alphaTest}
                    toneMapped={false}
                    {...(color !== undefined ? { color } : {})}
                    {...(opacity !== undefined ? { opacity } : {})}
                    {...(blending !== undefined ? { blending: SPRITE_BLENDING[blending] } : {})}
                    {...(depthWrite !== undefined ? { depthWrite } : {})}
                    {...(depthTest !== undefined ? { depthTest } : {})}
                />
            )}
            {children}
        </mesh>
    );
}
