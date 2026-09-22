// @vitest-environment jsdom

/**
 * renderer/components/r3f/AnimatedSprite.test.tsx
 *
 * The component a game actually mounts: ref in, animated quad out.
 *
 * **What is asserted, and against what.** The quad is a REAL `PlaneGeometry` —
 * the component allocates it rather than declaring `<planeGeometry>` precisely
 * so it owns a handle to pass the backend — so the cells it shows are read off
 * the same `uv` array a shader would sample. The R3F intrinsics around it
 * (`<mesh>`, `<meshBasicMaterial>`) render as inert DOM under the fiber
 * stand-in; what this file covers is the wiring from an `AssetRef` through the
 * manager to a moving quad.
 *
 * **Why a geometry ledger rather than a ref.** Exposing the geometry just to
 * test it would freeze it into the public surface. The `three` mock records
 * every `PlaneGeometry` constructed, which is the same shape as the mixer
 * ledger in `useClipPlayer.test.tsx`, and it answers the one question a ref
 * would — plus how MANY were built, which is the StrictMode leak.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BufferGeometry as ThreeBufferGeometry,
    Material as ThreeMaterial,
    MeshDepthMaterial as ThreeMeshDepthMaterial,
    MeshStandardMaterial as ThreeMeshStandardMaterial,
} from 'three';
import type * as ThreeModule from 'three';

import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, LoadedSpriteSheetAsset } from '../../assets/AssetManager.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import { resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { intrinsicProps } from './__test-support__/intrinsicProps';
import { AnimatedSprite, MATERIAL_INTRINSIC } from './AnimatedSprite';

vi.mock('@react-three/fiber', () => import('./__test-support__/fakeFiberRoot'));

const { geometryLog } = vi.hoisted(() => ({
    geometryLog: { created: [] as { geometry: unknown; disposed: boolean }[] },
}));

vi.mock('three', async (importOriginal) => {
    const original = await importOriginal<typeof ThreeModule>();
    class TrackedPlaneGeometry extends original.PlaneGeometry {
        constructor(width?: number, height?: number) {
            super(width, height);
            geometryLog.created.push({ geometry: this, disposed: false });
        }
        override dispose(): void {
            const entry = geometryLog.created.find((record) => record.geometry === this);
            if (entry !== undefined) {
                entry.disposed = true;
            }
            super.dispose();
        }
    }
    return { ...original, PlaneGeometry: TrackedPlaneGeometry };
});

// ─── fixtures ───────────────────────────────────────────────────────────────────

const RUN_REF: AssetRef<SpriteSheetAsset> = buildAssetRef<SpriteSheetAsset>(
    'tactics',
    'sprites/runner.json',
);

/** Four 16x16 cells cut from a 64x16 strip, so cell N starts at u = N/4. */
function createLoadedSheet(): LoadedSpriteSheetAsset {
    return {
        texture: { image: { width: 64, height: 16 } },
        frames: {
            run_0: { frame: { x: 0, y: 0, w: 16, h: 16 } },
            run_1: { frame: { x: 16, y: 0, w: 16, h: 16 } },
            run_2: { frame: { x: 32, y: 0, w: 16, h: 16 } },
            run_3: { frame: { x: 48, y: 0, w: 16, h: 16 } },
        },
    } as unknown as LoadedSpriteSheetAsset;
}

/**
 * A 1-second, 4-frame run: one cell per quarter-second.
 *
 * Module-scope, the way a game authors one — and load-bearing: the manager
 * returns the authored object verbatim, so a `getManifestMetadata` that BUILT
 * one per call would hand a new sheet identity to every render and restart the
 * clip on each of them.
 */
const SPRITE_METADATA = {
    clips: { run: { frames: [0, 1, 2, 3], durationSeconds: 1 } },
};

/** The same run, plus a notify at the halfway point. */
const SPRITE_METADATA_WITH_NOTIFY = {
    clips: {
        run: { frames: [0, 1, 2, 3], durationSeconds: 1, notifies: { step: { at: 0.5 } } },
    },
};

function createManager(overrides: Partial<AssetManager> = {}): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get: () => null,
        getManifestMetadata: () => SPRITE_METADATA,
        load: () => Promise.resolve(createLoadedSheet()),
        dispose(): void {},
        ...overrides,
    } as unknown as AssetManager;
}

function renderSprite(
    element: React.ReactElement,
    manager: AssetManager = createManager(),
): ReturnType<typeof render> {
    return render(
        <AssetManagerContext.Provider value={manager}>{element}</AssetManagerContext.Provider>,
    );
}

/** The quad the component allocated. */
function currentGeometry(): ThreeModule.PlaneGeometry {
    const entry = geometryLog.created.at(-1);
    if (entry === undefined) {
        throw new Error('no PlaneGeometry was constructed');
    }
    return entry.geometry as ThreeModule.PlaneGeometry;
}

/** Which atlas cell is on the quad, read off the real `uv` attribute. */
function shownCellIndex(): number {
    const uv = currentGeometry().attributes['uv'];
    if (uv === undefined) {
        throw new Error('geometry has no uv attribute');
    }
    return Math.round(uv.getX(0) * 4);
}

/**
 * How many times the quad's `uv` attribute has been marked dirty.
 *
 * A fresh `PlaneGeometry`'s uv ALREADY reads as cell 0, so "the shown cell is 0"
 * is true of an untouched quad and cannot say whether the sheet has loaded and
 * the player is driving. `BufferAttribute.version` increments on the
 * `needsUpdate = true` the backend sets when it writes, so a non-zero version is
 * the one signal that separates a seated first cell from an unwritten quad.
 *
 * Read through a structural type because `BufferGeometry.attributes` is typed as
 * a union with `InterleavedBufferAttribute`, which declares no `version` — a
 * `PlaneGeometry` never produces one.
 */
function uvVersion(): number {
    const uv: unknown = currentGeometry().attributes['uv'];
    return (uv as { readonly version?: number } | undefined)?.version ?? 0;
}

/** Wait until the backend has actually written a cell. */
async function waitForFirstWrite(): Promise<void> {
    await waitFor(() => {
        expect(geometryLog.created).not.toHaveLength(0);
        expect(uvVersion()).toBeGreaterThan(0);
    });
}

let frameClockSeconds = 0;

function advance(deltaSeconds: number): void {
    frameClockSeconds += deltaSeconds;
    act(() => {
        update(frameClockSeconds);
    });
}

beforeEach(() => {
    resetFakeFiberRoot();
    frameClockSeconds = 0;
    geometryLog.created.length = 0;
});

afterEach(() => {
    cleanup();
});

// ─── cases ──────────────────────────────────────────────────────────────────────

describe('AnimatedSprite plays a clip off an asset ref', () => {
    it('seats the clip’s first cell once the sheet has loaded', async () => {
        renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitForFirstWrite();

        expect(shownCellIndex()).toBe(0);
    });

    it('walks the cells as the frame loop advances', async () => {
        renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitForFirstWrite();

        advance(0.25);
        expect(shownCellIndex()).toBe(1);
        advance(0.25);
        expect(shownCellIndex()).toBe(2);
    });

    it('honours the declared loop mode', async () => {
        renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" loop="loop" />);

        await waitForFirstWrite();

        advance(1);

        expect(shownCellIndex()).toBe(0);
    });

    it('honours the declared speed', async () => {
        renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" speed={0.5} />);

        await waitForFirstWrite();

        advance(0.25);

        expect(shownCellIndex()).toBe(0);
    });

    it('fires the marks the sheet authors', async () => {
        const onNotify = vi.fn();
        renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" handlers={{ onNotify }} />,
            createManager({
                getManifestMetadata: () => SPRITE_METADATA_WITH_NOTIFY,
            }),
        );

        await waitForFirstWrite();
        advance(0.6);

        expect(onNotify).toHaveBeenCalledWith({ kind: 'notify', name: 'step' });
    });
});

describe('AnimatedSprite owns exactly one quad', () => {
    it('allocates one geometry and disposes it on unmount', async () => {
        const { unmount } = renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitFor(() => {
            expect(geometryLog.created).toHaveLength(1);
        });

        unmount();

        // The component allocated it, so the component releases it — the hook
        // under it never disposes a geometry it was handed.
        expect(geometryLog.created.every((entry) => entry.disposed)).toBe(true);
    });

    it('leaves no undisposed quad behind under StrictMode', async () => {
        const { unmount } = render(
            <React.StrictMode>
                <AssetManagerContext.Provider value={createManager()}>
                    <AnimatedSprite sheet={RUN_REF} clip="run" />
                </AssetManagerContext.Provider>
            </React.StrictMode>,
        );

        await waitFor(() => {
            expect(geometryLog.created).not.toHaveLength(0);
        });

        unmount();

        // StrictMode double-invokes the effect, so more than one may be built;
        // what must hold is that every one of them was released. A `useMemo`
        // allocation would leave the discarded one undisposed forever.
        expect(geometryLog.created.every((entry) => entry.disposed)).toBe(true);
    });
});

describe('AnimatedSprite is null-safe while its sheet loads', () => {
    it('renders no mesh at all while the sheet is still loading', () => {
        // The claim is about OUTPUT, not about not throwing: the mesh's default
        // material is opaque, so a quad mounted before the texture arrives is a
        // white unit square for the whole load. Asserted on the rendered tree
        // because that is the thing a player would see.
        const manager = createManager({ load: () => new Promise(() => {}) });

        const { container } = renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />, manager);

        expect(container.querySelector('mesh')).toBeNull();
        expect(container.innerHTML).toBe('');
    });

    it('mounts the mesh once the texture has decoded', async () => {
        // The positive control for the case above: without it, a gate that
        // returned null forever would satisfy every "renders nothing" assertion
        // in this file.
        const { container } = renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitFor(() => {
            expect(container.querySelector('mesh')).not.toBeNull();
        });
    });

    it('puts the sheet texture on the default material', async () => {
        // `map` is the one wire that decides whether the sprite shows art or a
        // white square. Read as a DOM attribute: the fiber stand-in renders the
        // intrinsics through react-dom, which stringifies an object prop on an
        // unrecognised element — so the ATTRIBUTE's presence is what separates
        // `map={texture}` from a material with no map at all.
        const { container } = renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitFor(() => {
            expect(container.querySelector('meshbasicmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')?.hasAttribute('map')).toBe(true);
    });

    it('sets transparent, toneMapped and alphaTest to true, false and 0.01 on the default material', async () => {
        // Today's three values, asserted BY VALUE and nothing wider. The claim
        // is that these three props hold these three values — not that they are
        // the right ones for sprite art.
        //
        // Read through `intrinsicProps` because the DOM is lossy here: react-dom
        // 19.2.5 drops a boolean-valued prop on an unrecognised element, so
        // `transparent` and `toneMapped={false}` leave no attribute to read and
        // a presence check could not separate them from absent.
        const { container } = renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />);

        await waitFor(() => {
            expect(container.querySelector('meshbasicmaterial')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        const props = intrinsicProps(material!);

        expect(props['transparent']).toBe(true);
        expect(props['toneMapped']).toBe(false);
        expect(props['alphaTest']).toBe(0.01);
    });

    it('still draws a sheet that decodes but measures to no atlas', async () => {
        // A sprite sheet loaded straight from an image: a texture, no descriptor
        // to cut cells from, so `parseSpriteAtlas` answers null. The gate reads
        // the TEXTURE, not the atlas, so the quad draws the whole image and
        // plays nothing — which is what a sheet with one implicit frame IS.
        // Without this fixture the paragraph saying so is unreachable, and
        // adding `|| atlas === null` to the gate would break it and fail nothing.
        const bare = {
            texture: { image: { width: 8, height: 8 } },
        } as unknown as LoadedSpriteSheetAsset;
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" />,
            createManager({
                load: (() => Promise.resolve(bare)) as unknown as AssetManager['load'],
            }),
        );

        await waitFor(() => {
            expect(container.querySelector('mesh')).not.toBeNull();
        });

        // Drawn, but never animated: with no atlas there is no backend, so the
        // quad keeps a plane's own uv.
        advance(1);
        expect(uvVersion()).toBe(0);
    });

    it('renders a caller-supplied material instead of the default one', async () => {
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <meshStandardMaterial />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        // A game that supplies a material owns its `map` too — the default one
        // must not also be emitted.
        expect(container.querySelector('meshbasicmaterial')).toBeNull();
    });

    it('keeps the mapped default material when a conditional child evaluates to false', async () => {
        // `{flag && <Mat/>}` passes `false` when the flag is off, and `false` is
        // not nullish. A `children ?? default` substitution therefore suppresses
        // the default on the commonest React conditional there is, and the mesh
        // falls back to three's implicit white MeshBasicMaterial with no map —
        // the white unit square the texture gate exists to keep off the screen.
        const showGlow = false;
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                {showGlow && <meshStandardMaterial />}
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('mesh')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('keeps the mapped default material when the only child is a non-material element', async () => {
        // A nested intrinsic is a CHILD, not a material. Suppressing the
        // material because something was passed confuses the two.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <group />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('mesh')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
        // …and the child is still rendered rather than swallowed.
        expect(container.querySelector('group')).not.toBeNull();
    });

    it('lets a material replace the default while a sibling non-material child still draws', async () => {
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <meshStandardMaterial />
                <group />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
        expect(container.querySelector('group')).not.toBeNull();
    });

    it('looks through a fragment to the material inside it', async () => {
        // Without this, a fragment would be classified as a non-material child
        // and the default would be emitted ALONGSIDE the caller's material —
        // two materials attaching to one mesh.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <>
                    <meshStandardMaterial />
                    <group />
                </>
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
    });

    it('keeps the mapped default material when the only child is text', async () => {
        // A string survives `React.Children.toArray` — unlike `false`, which it
        // drops — so the non-element arm is reachable, and this is what reaches
        // it. Without it, treating a non-element as a material loses the map.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                label
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('mesh')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('treats a memo-wrapped material component as the material', async () => {
        // `React.memo` and `forwardRef` both produce an OBJECT type rather than a
        // function, and wrapping a material component in one is ordinary. A
        // classifier that only recognised functions would emit the default
        // alongside the caller's material.
        const GlowMaterial = React.memo(function GlowMaterial(): React.ReactElement {
            return <meshStandardMaterial />;
        });

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <GlowMaterial />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
    });

    it('reads attach="material" as the material on an element whose name says nothing', async () => {
        // `<primitive>` is the shape a game uses to hand over a material it built
        // itself, and its element name carries no material-ness at all — the same
        // position a material registered under another name through `extend()` is
        // in. r3f honours a string `attach` before it infers anything from the
        // instantiated object, so `attach` is the signal that covers both.
        const material = new ThreeMeshStandardMaterial();

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <primitive object={material} attach="material" />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('primitive')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
        material.dispose();
    });

    it('keeps the mapped default material when a material-named child attaches elsewhere', async () => {
        // `<meshDepthMaterial attach="customDepthMaterial"/>` is the standard
        // shape for an alpha-cut shadow caster: a material by name that is NOT
        // the mesh's material. `attach` therefore has to decide BOTH ways — a
        // positive-only check falls through to the name and deletes the sprite's
        // own material, which is this issue's defect class exactly.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <meshDepthMaterial attach="customDepthMaterial" />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshdepthmaterial')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('reads a bare primitive holding a material as the material', async () => {
        // No `attach` at all — the form r3f would itself auto-attach as the
        // mesh's material, because the instance says `isMaterial`. The element
        // name says nothing, so `object` is the only thing that can answer.
        const material = new ThreeMeshStandardMaterial();

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <primitive object={material} />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('primitive')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
        material.dispose();
    });

    it('keeps the mapped default material when a material-named child attaches by hand', async () => {
        // The non-string side of the `attach` boundary. r3f's function form is a
        // caller doing the assignment itself, and r3f stops inferring from the
        // object for ANY defined `attach` — so a guard narrowed to strings would
        // send this child on to the name arm and delete the sprite's material.
        const attachByHand = (): (() => void) => (): void => {};

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <meshDepthMaterial attach={attachByHand} />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshdepthmaterial')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('lets attach overrule a primitive that is holding a material', async () => {
        // The one child both new arms can answer for, which is what makes their
        // ORDER a behaviour rather than a detail. `new MeshDepthMaterial(...)`
        // handed over as a shadow caster is a material instance by `isMaterial`
        // and not the mesh's material by `attach`; deciding from `object` first
        // would suppress the default and put the white square back.
        const depthMaterial = new ThreeMeshDepthMaterial();

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <primitive object={depthMaterial} attach="customDepthMaterial" />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('primitive')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
        depthMaterial.dispose();
    });

    it('keeps the mapped default material for a bare primitive holding a non-material', async () => {
        // The same form carrying something that is not a material — a geometry —
        // must not be read as one.
        const geometry = new ThreeBufferGeometry();

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <primitive object={geometry} />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('primitive')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
        geometry.dispose();
    });

    it('does not look through Suspense, and emits the default before the children', async () => {
        // Two claims, one fixture, because they are the same decision. Suspense
        // renders its FALLBACK when suspended, so looking through it would answer
        // "a material is here" for one that never mounts — the white-square
        // direction. Answering "no material" instead emits the default too, which
        // is only harmless because the caller's material is rendered AFTER it and
        // the later attach wins. That ordering is what makes the safe direction
        // safe, so it is pinned rather than assumed.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <React.Suspense fallback={null}>
                    <meshStandardMaterial />
                </React.Suspense>
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        const emitted = container.querySelector('mesh')?.children ?? [];
        const tags = [...emitted].map((element) => element.tagName.toLowerCase());

        expect(tags).toContain('meshbasicmaterial');
        expect(tags.indexOf('meshbasicmaterial')).toBeLessThan(
            tags.indexOf('meshstandardmaterial'),
        );
    });

    it('keeps the mapped default material when a fragment holds no material', async () => {
        // The negative side of the fragment gate. Answering "a material is here"
        // for a fragment because it IS a fragment loses the material with none
        // anywhere in the tree — the white-square direction, and the side every
        // other fragment fixture here leaves unmeasured by putting a material
        // inside.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <>
                    <group />
                </>
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('group')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('applies the attach rule inside a fragment, not just at the top level', async () => {
        // The recursion is what carries every other arm one level down. A
        // fragment check that matched on NAME alone would read this as the
        // mesh's material and delete the sprite's own — the same defect as at
        // the top level, one fragment deep.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <>
                    <meshDepthMaterial attach="customDepthMaterial" />
                </>
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshdepthmaterial')).not.toBeNull();
        });

        const material = container.querySelector('meshbasicmaterial');
        expect(material).not.toBeNull();
        expect(material?.hasAttribute('map')).toBe(true);
    });

    it('finds a material nested more than one array deep', async () => {
        // The case that separates `React.Children.toArray` from a shallow
        // flatten: nested `map` calls produce nested arrays, and a one-level
        // flatten would miss the material and emit the default alongside it.
        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                {[[<meshStandardMaterial key="glow" />]]}
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
    });

    it('treats a component child as the material, the one case children cannot decide', async () => {
        // Pinned because it is a DECISION, not an accident: a component could be
        // a material or a label and only rendering it would say which, so the
        // ambiguity resolves toward the existing contract. Changing that is a
        // breaking change and should red here.
        function GlowMaterial(): React.ReactElement {
            return <meshStandardMaterial />;
        }

        const { container } = renderSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run">
                <GlowMaterial />
            </AnimatedSprite>,
        );

        await waitFor(() => {
            expect(container.querySelector('meshstandardmaterial')).not.toBeNull();
        });

        expect(container.querySelector('meshbasicmaterial')).toBeNull();
    });

    it('accepts a null sheet ref and loads nothing', () => {
        // Typed through the manager's own signature: `AssetManager.load` is
        // generic over the asset kind, so a stub that only ever answers with a
        // sprite sheet does not satisfy it structurally.
        const load = vi.fn(() =>
            Promise.resolve(createLoadedSheet()),
        ) as unknown as AssetManager['load'];

        renderSprite(<AnimatedSprite sheet={null} clip="run" />, createManager({ load }));

        expect(load).not.toHaveBeenCalled();
    });

    it('accepts a null clip and leaves the quad unwritten', async () => {
        renderSprite(<AnimatedSprite sheet={RUN_REF} clip={null} />);

        await waitFor(() => {
            expect(geometryLog.created).not.toHaveLength(0);
        });
        advance(1);

        // Asserted on the VERSION, not the cell: an unwritten quad already reads
        // as cell 0, so `shownCellIndex() === 0` would hold whether or not the
        // sprite played — see `waitForFirstWrite`.
        expect(uvVersion()).toBe(0);
    });

    it('survives a sheet that fails to load, leaving the quad unwritten', async () => {
        const manager = createManager({
            load: () => Promise.reject(new Error('sheet 404')),
        });

        expect(() =>
            renderSprite(<AnimatedSprite sheet={RUN_REF} clip="run" />, manager),
        ).not.toThrow();

        await waitFor(() => {
            expect(geometryLog.created).not.toHaveLength(0);
        });
        advance(1);

        expect(uvVersion()).toBe(0);
    });
});

describe('the intrinsic-name match is sound and complete over three’s catalogue', () => {
    it('matches every Material subclass three exports and no other export', async () => {
        // The component decides an intrinsic by NAME, which is only safe if
        // "ends in Material" and "is a Material" are the same set in three's own
        // catalogue. That is a third-party property, so it is measured rather
        // than asserted in prose — and measured against the exported pattern
        // itself, not a copy of it.
        //
        // The pattern is applied to the INTRINSIC name, which is what the
        // component sees: r3f lowercases the class name's first character, so
        // `MeshStandardMaterial` is declared as `<meshStandardMaterial>`. Testing
        // the class name instead would measure a string the component never
        // classifies.
        const three = await import('three');
        const exported = Object.entries(three);

        const materials: string[] = [];
        const disagreements: string[] = [];

        for (const [name, value] of exported) {
            const intrinsicName = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
            const isMaterialClass =
                typeof value === 'function' &&
                (value === ThreeMaterial || value.prototype instanceof ThreeMaterial);
            if (isMaterialClass) {
                materials.push(intrinsicName);
            }
            if (isMaterialClass !== MATERIAL_INTRINSIC.test(intrinsicName)) {
                disagreements.push(intrinsicName);
            }
        }

        expect(disagreements).toEqual([]);

        // Controls. The agreement assertion above is satisfied by an enumeration
        // that found nothing, so both halves of what was enumerated are checked:
        // the namespace as a whole, which a partial mock would shrink, and the
        // material set within it, which is what the pattern is being measured
        // against. Neither bound is the exact count — that would be a hostage to
        // three's next release — but both are far enough below today's (441
        // exports, 18 materials) to survive a version bump and far enough above
        // zero to catch a namespace that stopped resolving.
        expect(exported.length).toBeGreaterThan(200);
        expect(materials.length).toBeGreaterThan(14);
        expect(materials).toContain('meshStandardMaterial');
    });
});
