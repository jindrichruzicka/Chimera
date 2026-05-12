/**
 * renderer/state/cameraStore.test.ts
 *
 * Unit tests for the cameraStore Zustand store.
 * Camera state is renderer-only (invariant #57); no IPC or simulation deps.
 */

import { describe, expect, it } from 'vitest';
import { createCameraStore } from './cameraStore';

// ── Default state ─────────────────────────────────────────────────────────────

describe('cameraStore — initial state', () => {
    it('has default position of (0, 0, 0)', () => {
        const store = createCameraStore();

        expect(store.getState().position).toEqual([0, 0, 0]);
    });

    it('has default lookAt of (0, 0, 0)', () => {
        const store = createCameraStore();

        expect(store.getState().lookAt).toEqual([0, 0, 0]);
    });

    it('has default zoom of 1', () => {
        const store = createCameraStore();

        expect(store.getState().zoom).toBe(1);
    });
});

// ── Setters ───────────────────────────────────────────────────────────────────

describe('cameraStore.setPosition()', () => {
    it('updates position and leaves other fields unchanged', () => {
        const store = createCameraStore();

        store.getState().setPosition([10, 20, 30]);

        expect(store.getState().position).toEqual([10, 20, 30]);
        expect(store.getState().lookAt).toEqual([0, 0, 0]);
        expect(store.getState().zoom).toBe(1);
    });

    it('reflects subsequent setPosition calls correctly', () => {
        const store = createCameraStore();

        store.getState().setPosition([1, 2, 3]);
        store.getState().setPosition([4, 5, 6]);

        expect(store.getState().position).toEqual([4, 5, 6]);
    });
});

describe('cameraStore.setLookAt()', () => {
    it('updates lookAt and leaves other fields unchanged', () => {
        const store = createCameraStore();

        store.getState().setLookAt([1, 2, 3]);

        expect(store.getState().lookAt).toEqual([1, 2, 3]);
        expect(store.getState().position).toEqual([0, 0, 0]);
        expect(store.getState().zoom).toBe(1);
    });

    it('reflects subsequent setLookAt calls correctly', () => {
        const store = createCameraStore();

        store.getState().setLookAt([5, 6, 7]);
        store.getState().setLookAt([8, 9, 10]);

        expect(store.getState().lookAt).toEqual([8, 9, 10]);
    });
});

describe('cameraStore.setZoom()', () => {
    it('updates zoom and leaves other fields unchanged', () => {
        const store = createCameraStore();

        store.getState().setZoom(2.5);

        expect(store.getState().zoom).toBe(2.5);
        expect(store.getState().position).toEqual([0, 0, 0]);
        expect(store.getState().lookAt).toEqual([0, 0, 0]);
    });

    it('reflects subsequent setZoom calls correctly', () => {
        const store = createCameraStore();

        store.getState().setZoom(0.5);
        store.getState().setZoom(3);

        expect(store.getState().zoom).toBe(3);
    });
});

// ── Singleton hook export ─────────────────────────────────────────────────────

describe('useCameraStore', () => {
    it('is exported and is a function', async () => {
        const cameraModule = await import('./cameraStore');

        expect(typeof cameraModule.useCameraStore).toBe('function');
    });

    it('returns initial state via direct getState accessor', async () => {
        const { useCameraStore } = await import('./cameraStore');

        const state = useCameraStore.getState();

        expect(state.position).toEqual([0, 0, 0]);
        expect(state.lookAt).toEqual([0, 0, 0]);
        expect(state.zoom).toBe(1);
    });
});
