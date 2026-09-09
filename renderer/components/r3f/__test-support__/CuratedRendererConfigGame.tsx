'use client';

/**
 * A game component that configures all four curated renderer concerns —
 * shadows, tone mapping (mode + exposure), output colour space and render
 * scale — through `GameCanvasProps` alone.
 *
 * It is a FIXTURE, never mounted: `curated-renderer-config-surface.test.ts`
 * reads its import declarations and asserts that neither `three` nor
 * `@react-three/fiber` is among them. That is the claim the curated surface
 * exists to make (Invariant #127) — a game names `'aces-filmic'`, not
 * `THREE.ACESFilmicToneMapping`, and mounts `GameCanvas`, not `Canvas`.
 *
 * It imports the barrel by relative path because it lives inside the renderer
 * package; a real game names the same symbols as
 * `@chimera-engine/renderer/components/r3f`, which is the only R3F surface a
 * game may import.
 */

import { GameCanvas } from '../index.js';
import type { OutputColorSpace, RenderScale, ShadowQuality, ToneMappingMode } from '../index.js';

const shadows: ShadowQuality = 'soft';
const toneMapping: ToneMappingMode = 'aces-filmic';
const outputColorSpace: OutputColorSpace = 'srgb';
const renderScale: RenderScale = [1, 2];

export function CuratedRendererConfigGame(): React.ReactElement {
    return (
        <GameCanvas
            camera="isometric"
            shadows={shadows}
            toneMapping={toneMapping}
            toneMappingExposure={1.2}
            outputColorSpace={outputColorSpace}
            renderScale={renderScale}
        >
            <mesh />
        </GameCanvas>
    );
}
