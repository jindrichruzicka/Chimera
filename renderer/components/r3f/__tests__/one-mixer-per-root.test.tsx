// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/one-mixer-per-root.test.tsx
 *
 * Rule ONE-MIXER-PER-ROOT across the two hooks that own a mixer. Neither
 * co-located suite can state this: each mocks `three` its own way and each
 * mounts one hook, so the pair only meets here.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Real `three`, real hooks, the `fakeFiberRoot` stand-in for
 * `@react-three/fiber`, and a stubbed rAF — the report is deferred one frame and
 * jsdom's timer-backed implementation cannot be flushed inside a case.
 *
 * The log bridge is stubbed for the same reason `mainCanvasRegistry.test.ts`
 * stubs it: `emitRendererError` is `logsApi?.emit` over an absent
 * `globalThis.__chimera.logs`, so an unstubbed run cannot tell a report that was
 * never made from one that went nowhere.
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from 'three';

import type { ModelInstance } from '../../../assets/ModelInstance.js';
import { readMixerBinding } from '../mixerBindingRegistry.js';
import { useClipPlayer } from '../useClipPlayer.js';
import { useModelAnimation } from '../useModelAnimation.js';

vi.mock('@react-three/fiber', () => import('../__test-support__/fakeFiberRoot'));

let logEmit: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;

beforeEach(() => {
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
    rafCallbacks = new Map();
    nextRafHandle = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
        const handle = nextRafHandle++;
        rafCallbacks.set(handle, callback);
        return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
        rafCallbacks.delete(handle);
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function flushFrame(): void {
    const due = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const callback of due) {
        callback(0);
    }
}

function loggedErrors(): { name?: string; message?: string }[] {
    return logEmit.mock.calls
        .map((call) => call[0] as { level: string; error?: { name?: string; message?: string } })
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.error ?? {});
}

function createInstance(): ModelInstance {
    return { root: new Object3D(), clips: [] };
}

function RawMixer({ instance }: { readonly instance: ModelInstance }): React.ReactElement {
    useModelAnimation(instance);
    return <div data-testid="raw-mixer" />;
}

/** `clip: null` plays nothing, so the only report a case can see is the duplicate. */
function BoundPlayer({ instance }: { readonly instance: ModelInstance }): React.ReactElement {
    useClipPlayer(instance, null, { clip: null });
    return <div data-testid="bound-player" />;
}

describe('two mixer-owning hooks on one model root', () => {
    it('reports exactly once after a frame, names both binders, and leaves the tree mounted', () => {
        const instance = createInstance();

        expect(() => {
            render(
                <>
                    <RawMixer instance={instance} />
                    <BoundPlayer instance={instance} />
                </>,
            );
        }).not.toThrow();

        // Deferred: nothing yet. R3F's ErrorBoundary re-throws OUTWARD past the
        // Canvas, so this fault is logged and never thrown (Invariant #67).
        expect(loggedErrors()).toEqual([]);

        flushFrame();

        expect(loggedErrors().map((error) => error.name)).toEqual(['DuplicateMixerBindingError']);
        const [reported] = loggedErrors();
        expect(String(reported?.message)).toContain('useModelAnimation');
        expect(String(reported?.message)).toContain('useClipPlayer');
        // Both hooks are still mounted and still rendering — the report is a log
        // entry, not a teardown.
        expect(screen.getByTestId('raw-mixer')).toBeDefined();
        expect(screen.getByTestId('bound-player')).toBeDefined();
    });

    it('cancels the pending report when one of the two unmounts before the frame fires', () => {
        const instance = createInstance();
        const { rerender } = render(
            <>
                <RawMixer instance={instance} />
                <BoundPlayer instance={instance} />
            </>,
        );

        // Only a pair still concurrent when the frame fires is a fault.
        rerender(
            <>
                <RawMixer instance={instance} />
            </>,
        );
        flushFrame();

        expect(loggedErrors()).toEqual([]);
        expect(readMixerBinding(instance.root)).toEqual({
            count: 1,
            binders: ['useModelAnimation'],
        });
    });

    it('reports nothing for two hooks on two different model roots', () => {
        // The positive control's opposite: two animated models in one scene are
        // ordinary, and the count is per root.
        render(
            <>
                <RawMixer instance={createInstance()} />
                <BoundPlayer instance={createInstance()} />
            </>,
        );

        flushFrame();

        expect(loggedErrors()).toEqual([]);
    });
});
