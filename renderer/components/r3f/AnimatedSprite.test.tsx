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
 * stand-in, so nothing here asserts about them; what this file covers is the
 * wiring from an `AssetRef` through the manager to a moving quad.
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

import type * as ThreeModule from 'three';

import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, LoadedSpriteSheetAsset } from '../../assets/AssetManager.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import { resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { AnimatedSprite } from './AnimatedSprite';

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
