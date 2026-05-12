/**
 * renderer/state/cameraStore.ts
 *
 * Optional Zustand store for camera state (position, lookAt, zoom).
 *
 * Architecture reference: §4.22 — Camera System
 *
 * Rules:
 *  - Renderer-only (invariant #57). Must NOT be imported from simulation/, ai/, or electron/main/.
 *  - Three.js (via R3F) remains the authoritative camera source of truth.
 *  - This store exists solely to observe/persist camera state across component remounts
 *    within a single game session.
 *  - Components subscribe through narrow typed selectors only.
 *  - GameCanvas and useCamera() may optionally write to this store.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CameraVector3 = readonly [x: number, y: number, z: number];

export interface CameraStoreState {
    /** Camera world position. Mirrors the Three.js camera position. */
    readonly position: CameraVector3;

    /** Camera look-at target in world space. */
    readonly lookAt: CameraVector3;

    /** Camera zoom factor (orthographic) or fov-derived scalar (perspective). */
    readonly zoom: number;

    /** Update the stored camera position. */
    setPosition(this: void, position: CameraVector3): void;

    /** Update the stored look-at target. */
    setLookAt(this: void, lookAt: CameraVector3): void;

    /** Update the stored zoom value. */
    setZoom(this: void, zoom: number): void;
}

// ── Factory (isolated instance for testing) ───────────────────────────────────

export function createCameraStore(): StoreApi<CameraStoreState> {
    return createStore<CameraStoreState>()((set) => ({
        position: [0, 0, 0],
        lookAt: [0, 0, 0],
        zoom: 1,

        setPosition(position: CameraVector3): void {
            set(() => ({ position }));
        },

        setLookAt(lookAt: CameraVector3): void {
            set(() => ({ lookAt }));
        },

        setZoom(zoom: number): void {
            set(() => ({ zoom }));
        },
    }));
}

// ── Singleton store ───────────────────────────────────────────────────────────

const cameraStoreInstance = createCameraStore();

/**
 * Zustand hook for the camera store.
 *
 * Always subscribe via a narrow selector:
 *
 * ```typescript
 * // ✅ Narrow selector
 * const position = useCameraStore((s) => s.position);
 * ```
 */
export function useCameraStore<T>(selector: (state: CameraStoreState) => T): T {
    return useStore(cameraStoreInstance, selector);
}

// Expose static accessors for direct store access (game board components, tests)
useCameraStore.getState = cameraStoreInstance.getState.bind(cameraStoreInstance);
useCameraStore.setState = cameraStoreInstance.setState.bind(cameraStoreInstance);
useCameraStore.subscribe = cameraStoreInstance.subscribe.bind(cameraStoreInstance);
