// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Group } from 'three';
import type * as ThreeModule from 'three';
import type { AnimationMixer } from 'three';

import type { ModelInstance } from '../../assets/ModelInstance.js';
import { readMixerBinding } from './mixerBindingRegistry.js';
import { useModelAnimation } from './useModelAnimation.js';

const { recordedFrames, mixerLog } = vi.hoisted(() => ({
    recordedFrames: [] as {
        callback: (state: unknown, deltaSeconds: number) => void;
        priority: number | undefined;
    }[],
    mixerLog: {
        created: [] as unknown[],
        events: [] as { kind: 'stopAllAction' | 'uncacheRoot'; mixer: unknown; root?: unknown }[],
    },
}));

vi.mock('@react-three/fiber', () => ({
    useFrame: vi.fn(
        (callback: (state: unknown, deltaSeconds: number) => void, priority?: number) => {
            recordedFrames.push({ callback, priority });
        },
    ),
}));

vi.mock('three', async (importOriginal) => {
    const original = await importOriginal<typeof ThreeModule>();
    class TrackedAnimationMixer extends original.AnimationMixer {
        constructor(root: ThreeModule.Object3D) {
            super(root);
            mixerLog.created.push(this);
        }
        override stopAllAction(): AnimationMixer {
            mixerLog.events.push({ kind: 'stopAllAction', mixer: this });
            return super.stopAllAction();
        }
        override uncacheRoot(root: ThreeModule.Object3D): void {
            mixerLog.events.push({ kind: 'uncacheRoot', mixer: this, root });
            super.uncacheRoot(root);
        }
    }
    return { ...original, AnimationMixer: TrackedAnimationMixer };
});

beforeEach(() => {
    recordedFrames.length = 0;
    mixerLog.created.length = 0;
    mixerLog.events.length = 0;
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
});

function createInstance(): ModelInstance {
    return { root: new Group(), clips: [] };
}

function requireMixer(value: AnimationMixer | null): AnimationMixer {
    if (value === null) {
        throw new Error('Expected the hook to have published an AnimationMixer.');
    }
    return value;
}

/**
 * Drives one frame the way R3F would: the real `useFrame` keeps a single
 * subscription whose ref always points at the latest render's callback, so
 * only the LAST recorded callback is "live".
 */
function driveFrame(deltaSeconds: number): void {
    const lastRecorded = recordedFrames[recordedFrames.length - 1];
    if (lastRecorded === undefined) {
        throw new Error('No frame callback was recorded.');
    }
    lastRecorded.callback({}, deltaSeconds);
}

function releasedEventKindsFor(mixer: unknown): string[] {
    return mixerLog.events.filter((event) => event.mixer === mixer).map((event) => event.kind);
}

/**
 * A REAL StrictMode double mount. `useClipPlayer.test.tsx` records the probe and
 * the versions it was taken against; the short of it is that the simulated
 * mount/unmount/remount happens only when `<StrictMode>` is the element handed
 * to `root.render`, which the `wrapper` option is not.
 *
 * The render phase is the half that does NOT need this: a nested `<StrictMode>`
 * still double-invokes render and every `useMemo` factory under it. So a suite
 * asserting a memo's identity may take the `wrapper` form and mean it —
 * `useAnimationSheet.test.tsx` does — while a mixer allocated in an EFFECT is
 * out of that form's reach.
 */
const STRICT = { reactStrictMode: true } as const;

describe('useModelAnimation', () => {
    it('registers its frame callback at the default render priority on every render', async () => {
        const instance = createInstance();
        const { rerender } = renderHook(() => useModelAnimation(instance));
        await act(async () => {
            await Promise.resolve();
        });
        rerender();

        expect(recordedFrames.length).toBeGreaterThanOrEqual(1);
        for (const { priority } of recordedFrames) {
            expect(priority).toBeUndefined();
        }
    });

    it('returns null before the commit-phase effect and advances the mixer exactly once per frame with the supplied delta', async () => {
        const instance = createInstance();
        const observed: (AnimationMixer | null)[] = [];
        const { result } = renderHook(() => {
            const mixer = useModelAnimation(instance);
            observed.push(mixer);
            return mixer;
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(observed[0]).toBeNull();
        const mixer = requireMixer(result.current);
        const updateSpy = vi.spyOn(mixer, 'update');

        driveFrame(0.016);
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).toHaveBeenCalledWith(0.016);

        driveFrame(0.033);
        expect(updateSpy).toHaveBeenCalledTimes(2);
        expect(updateSpy).toHaveBeenLastCalledWith(0.033);
    });

    it('keeps the mixer identity across re-renders and creates a new one when the instance identity changes', async () => {
        let instance = createInstance();
        const { result, rerender } = renderHook(() => useModelAnimation(instance));
        await act(async () => {
            await Promise.resolve();
        });
        const firstMixer = requireMixer(result.current);
        const createdAfterFirst = mixerLog.created.length;

        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current).toBe(firstMixer);
        expect(mixerLog.created.length).toBe(createdAfterFirst);

        instance = createInstance();
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        const secondMixer = requireMixer(result.current);
        expect(secondMixer).not.toBe(firstMixer);
        expect(mixerLog.created.length).toBe(createdAfterFirst + 1);
        expect(releasedEventKindsFor(firstMixer)).toEqual(['stopAllAction', 'uncacheRoot']);
    });

    it('releases with stopAllAction then uncacheRoot(root), and creations equal releases after a StrictMode mount/unmount', async () => {
        const instance = createInstance();
        const { result, unmount } = renderHook(() => useModelAnimation(instance), STRICT);
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current).not.toBeNull();

        // Only a REAL double mount allocates twice — setup, cleanup, setup. The
        // `wrapper` form allocates exactly ONE, so this count is what tells the
        // two forms apart, and no `>= 1` bound can.
        expect(mixerLog.created).toHaveLength(2);
        // Release happens AT the simulated unmount — not deferred to the real
        // one, and not at allocation. Both halves are needed to say that: the
        // loop after `unmount()` reads the same recorded kinds whenever they
        // were recorded, and a release moved into the effect SETUP leaves the
        // discarded mixer looking correctly released here too. The live mixer
        // having recorded nothing yet is what tells those apart.
        expect(releasedEventKindsFor(mixerLog.created[0])).toEqual([
            'stopAllAction',
            'uncacheRoot',
        ]);
        expect(releasedEventKindsFor(mixerLog.created[1])).toEqual([]);

        unmount();

        for (const mixer of mixerLog.created) {
            expect(releasedEventKindsFor(mixer)).toEqual(['stopAllAction', 'uncacheRoot']);
        }
        const uncacheEvents = mixerLog.events.filter((event) => event.kind === 'uncacheRoot');
        expect(uncacheEvents).toHaveLength(2);
        for (const event of uncacheEvents) {
            expect(event.root).toBe(instance.root);
        }
    });

    it('returns null again and stops driving the released mixer after the instance changes to null', async () => {
        let instance: ModelInstance | null = createInstance();
        const { result, rerender } = renderHook(() => useModelAnimation(instance));
        await act(async () => {
            await Promise.resolve();
        });
        const mixer = requireMixer(result.current);
        const updateSpy = vi.spyOn(mixer, 'update');

        instance = null;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current).toBeNull();
        expect(releasedEventKindsFor(mixer)).toEqual(['stopAllAction', 'uncacheRoot']);
        driveFrame(0.016);
        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('returns null for a null instance, creates no mixer, and keeps every registered frame callback inert', async () => {
        const { result } = renderHook(() => useModelAnimation(null));
        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current).toBeNull();
        expect(mixerLog.created).toHaveLength(0);
        // Contract is an inert callback, not an absent subscription — see the
        // rules-of-hooks note above useFrame in useModelAnimation.ts.
        for (const { callback } of recordedFrames) {
            expect(() => {
                callback({}, 0.016);
            }).not.toThrow();
        }
        expect(mixerLog.events).toHaveLength(0);
    });
});

describe('useModelAnimation — Rule ONE-MIXER-PER-ROOT', () => {
    // `emitRendererError` is `logsApi?.emit`, and the emitter comes from an
    // absent `globalThis.__chimera.logs` under vitest — so without this stub a
    // spurious report would be silently swallowed and every case below would
    // pass on a broken registry. The rAF stub is the second half: the report is
    // deferred by a frame, and jsdom's timer-backed rAF cannot be flushed here.
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
        vi.unstubAllGlobals();
    });

    function flushFrame(): void {
        const due = [...rafCallbacks.values()];
        rafCallbacks.clear();
        for (const callback of due) {
            callback(0);
        }
    }

    function reportedErrorNames(): (string | undefined)[] {
        return logEmit.mock.calls
            .map((call) => call[0] as { level: string; error?: { name?: string } })
            .filter((entry) => entry.level === 'error')
            .map((entry) => entry.error?.name);
    }

    it('reports nothing for a StrictMode double mount on one stable instance', async () => {
        const instance = createInstance();
        const { unmount } = renderHook(() => useModelAnimation(instance), STRICT);
        await act(async () => {
            await Promise.resolve();
        });

        flushFrame();

        expect(reportedErrorNames()).toEqual([]);
        unmount();
    });

    it('leaves no registry entry after ten mount/unmount cycles on one root', async () => {
        const instance = createInstance();

        for (let cycle = 0; cycle < 10; cycle += 1) {
            const { unmount } = renderHook(() => useModelAnimation(instance));
            await act(async () => {
                await Promise.resolve();
            });
            unmount();
            flushFrame();
        }

        expect(reportedErrorNames()).toEqual([]);
        // A fresh bind must behave as a FIRST bind: a ledger that kept counting
        // would report on the eleventh mount with nothing wrong.
        expect(readMixerBinding(instance.root)).toBeNull();
    });

    it('holds exactly one claim while mounted, named for this hook', async () => {
        const instance = createInstance();
        const { unmount } = renderHook(() => useModelAnimation(instance));
        await act(async () => {
            await Promise.resolve();
        });

        expect(readMixerBinding(instance.root)).toEqual({
            count: 1,
            binders: ['useModelAnimation'],
        });

        unmount();
        expect(readMixerBinding(instance.root)).toBeNull();
    });

    it('releases the claim on the old root when the instance changes', async () => {
        let instance = createInstance();
        const firstRoot = instance.root;
        const { rerender, unmount } = renderHook(() => useModelAnimation(instance));
        await act(async () => {
            await Promise.resolve();
        });

        instance = createInstance();
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        flushFrame();

        expect(readMixerBinding(firstRoot)).toBeNull();
        expect(readMixerBinding(instance.root)).toEqual({
            count: 1,
            binders: ['useModelAnimation'],
        });
        expect(reportedErrorNames()).toEqual([]);
        unmount();
    });
});

describe('useModelAnimation module shape', () => {
    function readSource(fileName: string): string {
        // Vite rewrites `new URL(<relative>, import.meta.url)` asset
        // references to root-relative URLs: this dynamic-template form yields
        // `file:///<path rooted at the vitest --dir>` — a direct read
        // ENOENTs — while raw `import.meta.url` stays the true absolute file
        // URL. Resolve the pathname against cwd; every pnpm-run script's cwd
        // is the --dir.
        const moduleUrl = new URL(`./${fileName}`, import.meta.url);
        const directPath =
            moduleUrl.protocol === 'file:' ? fileURLToPath(moduleUrl) : moduleUrl.pathname;
        const modulePath = existsSync(directPath)
            ? directPath
            : join(process.cwd(), moduleUrl.pathname);
        return readFileSync(modulePath, 'utf8');
    }

    /**
     * Comments stripped, so a guard about CALLS cannot be tripped by prose that
     * merely names the API — the header explains why this hook does not
     * invalidate, and saying so must not read as doing so.
     */
    function stripComments(source: string): string {
        return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    }

    it(`keeps 'use client' as line 1 and contains no timers and no frame-invalidation call`, () => {
        const source = readSource('useModelAnimation.ts');
        const [firstLine] = source.split('\n');

        expect(firstLine).toBe(`'use client';`);
        expect(stripComments(source)).not.toMatch(/setInterval|setTimeout|invalidate/);
    });

    // The stripper is tested on fixtures, not on the module's live prose: a
    // guard that leans on another file's wording breaks when that file is
    // reworded, for a reason unrelated to what it guards. Equality, not
    // `toMatch` — an alternation is satisfied by any one token surviving, so it
    // cannot see a stripper that erases only the others.
    it.each([
        [
            'a block comment naming the API',
            '/* calls invalidate() */\nconst a = 1;',
            '\nconst a = 1;',
        ],
        ['a line comment naming a timer', '// never setTimeout\nconst b = 2;', '\nconst b = 2;'],
        [
            'code between two block comments',
            '/* one */\nsetTimeout(f, 0);\n/* two */',
            '\nsetTimeout(f, 0);\n',
        ],
        [
            'a url, whose // is not a comment',
            'const u = "https://x/y"; invalidate();',
            'const u = "https://x/y"; invalidate();',
        ],
        [
            'a comment on a code line',
            'invalidate(); // why\nconst c = 3;',
            'invalidate(); \nconst c = 3;',
        ],
    ])('strips %s', (_name, input, expected) => {
        expect(stripComments(input)).toBe(expected);
    });

    it('is exported from the r3f barrel by exactly one export line', () => {
        const barrelSource = readSource('index.ts');
        const exportLines = barrelSource
            .split('\n')
            .filter((line) => line.startsWith('export') && line.includes('useModelAnimation'));

        expect(exportLines).toEqual([`export { useModelAnimation } from './useModelAnimation';`]);
    });
});
