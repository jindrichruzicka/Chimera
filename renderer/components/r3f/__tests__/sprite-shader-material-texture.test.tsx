// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/sprite-shader-material-texture.test.tsx
 *
 * How a game's own `ShaderMaterial` receives the sheet texture `AnimatedSprite`
 * has already resolved, measured against the real `@react-three/fiber`.
 *
 * The `material` prop hands the texture over as a `map` PROP. A bare
 * `ShaderMaterial` samples its `uniforms`, not a `map` property, so the shape
 * that reaches a shader is a material COMPONENT: it receives `map`, seats it in
 * the uniforms it constructs its own `ShaderMaterial` with, and hands that
 * instance over as a `<primitive>`, which the engine writes nothing into.
 * `AnimatedSprite.test.tsx` pins which elements receive `map`; it renders under
 * a fiber stand-in, so what r3f itself does with the result is measured here.
 *
 * **Why `three` and `applyProps` are `require`d.** r3f handles `uniforms` on a
 * branch guarded by `root instanceof THREE.ShaderMaterial`, and under vitest the
 * vite-transformed ESM `three` is a different module instance from the CJS
 * `three` that CJS-built r3f requires. A material built from the ESM copy fails
 * that `instanceof`. The materials here are built from r3f's own copy. The
 * last case is the control that they are: it reds when r3f does not recognise
 * the class these cases build.
 */

import { createRequire } from 'node:module';

import React from 'react';
import ReactThreeTestRenderer, { type ReactThreeTest } from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';

import type * as FiberModule from '@react-three/fiber';
import type * as ThreeModule from 'three';

import { buildAssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetRef, SpriteSheetAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager, LoadedSpriteSheetAsset } from '../../../assets/AssetManager.js';
import { AssetManagerContext } from '../../../assets/AssetManagerContext.js';
import { AnimatedSprite } from '../AnimatedSprite.js';
import { useShaderTime } from '../useShaderTime.js';

const require_ = createRequire(import.meta.url);
const { ShaderMaterial } = require_('three') as typeof ThreeModule;
const { applyProps } = require_('@react-three/fiber') as typeof FiberModule;

type TestRenderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>;
type ShaderMaterialInstance = InstanceType<typeof ShaderMaterial>;

const RUN_REF: AssetRef<SpriteSheetAsset> = buildAssetRef<SpriteSheetAsset>(
    'tactics',
    'sprites/runner.json',
);
const WALK_REF: AssetRef<SpriteSheetAsset> = buildAssetRef<SpriteSheetAsset>(
    'tactics',
    'sprites/walker.json',
);

const SPRITE_METADATA = {
    clips: { run: { frames: [0, 1], durationSeconds: 1 } },
};

/** Two 16x16 cells cut from a 32x16 strip. */
function createLoadedSheet(): LoadedSpriteSheetAsset {
    return {
        texture: { image: { width: 32, height: 16 } },
        frames: {
            run_0: { frame: { x: 0, y: 0, w: 16, h: 16 } },
            run_1: { frame: { x: 16, y: 0, w: 16, h: 16 } },
        },
    } as unknown as LoadedSpriteSheetAsset;
}

function createManager(
    sheets: ReadonlyMap<AssetRef<SpriteSheetAsset>, LoadedSpriteSheetAsset>,
): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get: () => null,
        getManifestMetadata: () => SPRITE_METADATA,
        load: (ref: AssetRef<SpriteSheetAsset>) => {
            const sheet = sheets.get(ref);
            return sheet === undefined
                ? Promise.reject(new Error(`no sheet for ${ref}`))
                : Promise.resolve(sheet);
        },
        dispose(): void {},
    } as unknown as AssetManager;
}

/** What the game's material component built, recorded so a case can find it. */
interface BuiltMaterial {
    readonly material: ShaderMaterialInstance;
    readonly map: unknown;
    disposed: boolean;
}

/**
 * The documented shape: a material component that receives `map` from the
 * sprite, seats it and the shader time uniform in the constructor, and hands the
 * instance over. `map` is optional only so `<SheetShader />` type-checks without
 * it — the sprite is what passes it.
 */
function sheetShader(built: BuiltMaterial[]): React.FC<{ readonly map?: unknown }> {
    return function SheetShader({ map }) {
        const time = useShaderTime();
        const [material, setMaterial] = React.useState<ShaderMaterialInstance | null>(null);

        React.useLayoutEffect(() => {
            const created = new ShaderMaterial({
                uniforms: { uTime: time, uMap: { value: map ?? null } },
            });
            const record: BuiltMaterial = { material: created, map, disposed: false };
            // Read off three's own dispose event, so the record says the material
            // was disposed rather than that this cleanup ran.
            created.addEventListener('dispose', () => {
                record.disposed = true;
            });
            built.push(record);
            setMaterial(created);
            return () => {
                setMaterial(null);
                created.dispose();
            };
        }, [time, map]);

        return material === null ? null : <primitive object={material} attach="material" />;
    };
}

async function mountSprite(node: React.ReactElement, manager: AssetManager): Promise<TestRenderer> {
    const renderer = await ReactThreeTestRenderer.create(
        <AssetManagerContext.Provider value={manager}>{node}</AssetManagerContext.Provider>,
    );
    await settle();
    return renderer;
}

async function updateSprite(
    renderer: TestRenderer,
    node: React.ReactElement,
    manager: AssetManager,
): Promise<void> {
    await renderer.update(
        <AssetManagerContext.Provider value={manager}>{node}</AssetManagerContext.Provider>,
    );
    await settle();
}

/** Let the sheet's load promise resolve and every commit it causes land. */
async function settle(): Promise<void> {
    for (let pass = 0; pass < 5; pass += 1) {
        await ReactThreeTestRenderer.act(async () => {
            await Promise.resolve();
        });
    }
}

/** The single mesh in the scene; fails on none or several. */
function onlyMesh(renderer: TestRenderer): ThreeModule.Mesh {
    const meshes = renderer.scene.allChildren.filter(
        (child: ReactThreeTest.ReactThreeTestInstance) => child.type === 'Mesh',
    );
    expect(meshes).toHaveLength(1);
    return meshes[0]!.instance as ThreeModule.Mesh;
}

describe('a ShaderMaterial on AnimatedSprite receives the sheet texture through a material component', () => {
    it('cannot take it as the map prop: r3f sets a property and seats no uniform', () => {
        // Why the shape is a component. The `material` prop's handoff is a `map`
        // PROP; on a bare `ShaderMaterial` r3f assigns `material.map` and leaves
        // `uniforms`, which is what the shader samples, as it found them.
        const texture = createLoadedSheet().texture;
        const material = new ShaderMaterial();

        applyProps(material as never, { map: texture });

        expect((material as unknown as { readonly map: unknown }).map).toBe(texture);
        expect(Object.keys(material.uniforms)).toEqual([]);
    });

    it('seats the texture the sprite resolved in the uniforms the game built its material with', async () => {
        const sheet = createLoadedSheet();
        const built: BuiltMaterial[] = [];
        const SheetShader = sheetShader(built);
        const renderer = await mountSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" material={<SheetShader />} />,
            createManager(new Map([[RUN_REF, sheet]])),
        );

        try {
            const mesh = onlyMesh(renderer);
            const own = built.at(-1)!;

            expect(mesh.material).toBe(own.material);
            expect(own.material.uniforms['uMap']?.value).toBe(sheet.texture);
            // Nothing written into the game's instance: no `map` property, and
            // no uniform the game did not seat.
            expect(own.material).not.toHaveProperty('map');
            expect(Object.keys(own.material.uniforms).sort()).toEqual(['uMap', 'uTime']);
        } finally {
            await renderer.unmount();
        }
    });

    it('keeps the shader time uniform live beside it', async () => {
        // The composition the docs show: the time uniform the hook advances is
        // the one the material holds, with the texture seated next to it.
        const sheet = createLoadedSheet();
        const built: BuiltMaterial[] = [];
        const SheetShader = sheetShader(built);
        const renderer = await mountSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" material={<SheetShader />} />,
            createManager(new Map([[RUN_REF, sheet]])),
        );

        try {
            await renderer.advanceFrames(4, 0.25);

            const { uniforms } = built.at(-1)!.material;
            expect(uniforms['uTime']?.value).toBeCloseTo(1);
            expect(uniforms['uMap']?.value).toBe(sheet.texture);
        } finally {
            await renderer.unmount();
        }
    });

    it('leaves the game material untouched across a sprite re-render', async () => {
        const sheet = createLoadedSheet();
        const built: BuiltMaterial[] = [];
        const SheetShader = sheetShader(built);
        const manager = createManager(new Map([[RUN_REF, sheet]]));
        const renderer = await mountSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" material={<SheetShader />} />,
            manager,
        );

        try {
            const own = built.at(-1)!;
            const seated = own.material.uniforms['uMap'];

            await updateSprite(
                renderer,
                <AnimatedSprite
                    sheet={RUN_REF}
                    clip="run"
                    position={[1, 2, 0]}
                    material={<SheetShader />}
                />,
                manager,
            );

            expect(built).toHaveLength(1);
            expect(onlyMesh(renderer).material).toBe(own.material);
            expect(own.material.uniforms['uMap']).toBe(seated);
            expect(own.material).not.toHaveProperty('map');
        } finally {
            await renderer.unmount();
        }
    });

    it('builds a material on the new texture when the sheet changes, and disposes the old one', async () => {
        const run = createLoadedSheet();
        const walk = createLoadedSheet();
        const built: BuiltMaterial[] = [];
        const SheetShader = sheetShader(built);
        const manager = createManager(
            new Map([
                [RUN_REF, run],
                [WALK_REF, walk],
            ]),
        );
        const renderer = await mountSprite(
            <AnimatedSprite sheet={RUN_REF} clip="run" material={<SheetShader />} />,
            manager,
        );

        try {
            const first = built.at(-1)!;

            await updateSprite(
                renderer,
                <AnimatedSprite sheet={WALK_REF} clip="run" material={<SheetShader />} />,
                manager,
            );

            const latest = built.at(-1)!;
            expect(latest).not.toBe(first);
            expect(onlyMesh(renderer).material).toBe(latest.material);
            expect(latest.material.uniforms['uMap']?.value).toBe(walk.texture);
            expect(first.disposed).toBe(true);
        } finally {
            await renderer.unmount();
        }
    });

    it('control: r3f takes its ShaderMaterial branch for the class these cases build', async () => {
        // r3f stores a shallow COPY of a uniform a `ShaderMaterial` does not
        // already carry, and only on its `instanceof ShaderMaterial` branch. A
        // material built from a duplicate `three` fails that test, r3f assigns
        // the passed object as it is, and identity is kept — so this reds.
        const material = new ShaderMaterial();
        const uniform = { value: 0 };
        const renderer = await ReactThreeTestRenderer.create(
            <mesh>
                <primitive object={material} attach="material" uniforms={{ uMap: uniform }} />
            </mesh>,
        );

        try {
            expect(onlyMesh(renderer).material).toBe(material);
            expect(material.uniforms['uMap']).not.toBe(uniform);
            expect(material.uniforms['uMap']).toEqual(uniform);
        } finally {
            await renderer.unmount();
        }
    });
});
