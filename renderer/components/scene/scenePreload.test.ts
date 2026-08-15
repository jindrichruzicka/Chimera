import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetResolver } from '../../assets/AssetResolver.js';
import {
    createAssetLoaderRegistry,
    type AssetLoadRequest,
} from '../../assets/AssetLoaderRegistry.js';
import { DefaultAssetManager, type AssetManager } from '../../assets/AssetManager.js';
import {
    SCENE_PRELOAD_BUDGET_MS,
    scenePreloadMeasuresProgress,
    startScenePreload,
    type ScenePreloadOutcome,
} from './scenePreload.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

const resolver: AssetResolver = { resolve: (ref) => `resolved://${String(ref)}` };

function ref(name: string): AssetRef<TextureAsset> {
    return `tactics/textures/${name}.png` as AssetRef<TextureAsset>;
}

function entry(
    assetRef: AssetRef<TextureAsset>,
    priority: AssetManifestEntry['priority'] = 'deferred',
): AssetManifestEntry {
    return { ref: assetRef, kind: 'texture', priority };
}

function manifest(entries: readonly AssetManifestEntry[]): AssetManifest {
    return { gameId: 'tactics', entries };
}

/**
 * A real `DefaultAssetManager` over a loader whose per-ref outcome the test
 * controls, rather than a hand-written stub.
 *
 * The eviction cases below turn on `registerManifest`'s own equivalence
 * comparison and on `get` reading the cache it keeps — behaviour a stub would
 * have to reimplement, and would then be asserting against itself.
 */
function buildManager(
    outcomes: Readonly<Record<string, 'resolve' | 'reject' | 'hang' | 'deferred'>> = {},
): {
    readonly assetManager: AssetManager;
    readonly registered: AssetManifest[];
    /** Settles a `'deferred'` ref — the seam for "the ref lands AFTER the budget". */
    readonly settleDeferred: (assetRef: AssetRef<TextureAsset>) => void;
} {
    const deferredResolvers = new Map<string, () => void>();
    const loaderRegistry = createAssetLoaderRegistry([
        {
            kind: 'texture',
            load: async (request: AssetLoadRequest): Promise<unknown> => {
                const key = String(request.ref);
                const outcome = outcomes[key] ?? 'resolve';
                if (outcome === 'reject') {
                    throw new Error(`load failed: ${key}`);
                }
                if (outcome === 'hang') {
                    return new Promise<never>(() => undefined);
                }
                if (outcome === 'deferred') {
                    await new Promise<void>((resolveLoad) => {
                        deferredResolvers.set(key, resolveLoad);
                    });
                }
                return { id: request.url };
            },
        },
    ]);

    const real = new DefaultAssetManager(resolver, loaderRegistry);
    const registered: AssetManifest[] = [];
    // Wrapped, not mocked: the real registration still happens, and the wrapper
    // only records WHAT was handed over — which is the sub-manifest hazard.
    const assetManager: AssetManager = {
        registerManifest: (m) => {
            registered.push(m);
            real.registerManifest(m);
        },
        preloadCritical: (m, onProgress) => real.preloadCritical(m, onProgress),
        get: (r) => real.get(r),
        load: (r) => real.load(r),
        getManifestMetadata: (r) => real.getManifestMetadata(r),
        dispose: () => real.dispose(),
    };

    return {
        assetManager,
        registered,
        settleDeferred: (assetRef) => {
            deferredResolvers.get(String(assetRef))?.();
        },
    };
}

/** Captures every renderer error emitted through the logs bridge. */
function captureEmits(): { readonly entries: unknown[] } {
    const entries: unknown[] = [];
    (globalThis as Record<string, unknown>)['__chimera'] = {
        logs: {
            emit: (payload: unknown) => {
                entries.push(payload);
            },
        },
    };
    return { entries };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__chimera'];
    vi.useRealTimers();
});

// ── the budget ────────────────────────────────────────────────────────────────

describe('SCENE_PRELOAD_BUDGET_MS', () => {
    it('is five seconds', () => {
        expect(SCENE_PRELOAD_BUDGET_MS).toBe(5_000);
    });

    it('is strictly under the barrier deadline the scene-transition spec allows', () => {
        // The e2e allows the barrier 15 s. A budget equal to that consumes the
        // whole allowance on exactly the path the fail-open exists to rescue,
        // and CI runners are an order of magnitude slower. Asserted here so a
        // future bump reds in this file rather than as an e2e flake.
        const SCENE_TRANSITION_BARRIER_POLL_MS = 15_000;

        expect(SCENE_PRELOAD_BUDGET_MS).toBeLessThan(SCENE_TRANSITION_BARRIER_POLL_MS);
    });
});

// ── what counts as a measured run ─────────────────────────────────────────────

describe('scenePreloadMeasuresProgress', () => {
    const measured = {
        assetManager: buildManager().assetManager,
        assetManifest: manifest([entry(ref('a'))]),
        requiredAssets: [ref('a')],
    };

    it('is true when a manager, a manifest and at least one ref are all present', () => {
        expect(scenePreloadMeasuresProgress(measured)).toBe(true);
    });

    // One case per input, never one fixture blanking several: each is what
    // makes the run below take its synchronous no-op path, and a caller reading
    // this predicate needs each to matter on its own.
    it.each([
        ['no manager', { assetManager: null }],
        ['no manifest', { assetManifest: undefined }],
        ['no declared refs', { requiredAssets: [] }],
    ])('is false with %s', (_case, blank) => {
        expect(scenePreloadMeasuresProgress({ ...measured, ...blank })).toBe(false);
    });

    it('is false for exactly the inputs startScenePreload skips', async () => {
        // The pairing is the point of exporting it: a caller gates its progress
        // channel on this, so a drift between the two would surface a fraction
        // for a run that measured nothing.
        for (const blank of [
            { assetManager: null },
            { assetManifest: undefined },
            { requiredAssets: [] },
        ]) {
            const inputs = { ...measured, ...blank };
            expect(scenePreloadMeasuresProgress(inputs)).toBe(false);
            await expect(startScenePreload(inputs).settled).resolves.toBe('skipped');
        }
        await expect(startScenePreload(measured).settled).resolves.not.toBe('skipped');
    });
});

// ── the four outcomes ─────────────────────────────────────────────────────────

describe('startScenePreload outcomes', () => {
    it('skips a scene that declares nothing, synchronously and without re-registering', async () => {
        const { assetManager, registered } = buildManager();
        const onProgress = vi.fn();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [],
            onProgress,
        });

        // Reported before any await: a scene with nothing to wait for must cost
        // what it cost before this gate existed, down to the microtask.
        expect(onProgress).toHaveBeenCalledExactlyOnceWith(1);
        expect(registered).toEqual([]);
        await expect(run.settled).resolves.toBe('skipped');
    });

    it('skips when the surface has no manager yet', async () => {
        const onProgress = vi.fn();

        const run = startScenePreload({
            assetManager: null,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            onProgress,
        });

        expect(onProgress).toHaveBeenCalledExactlyOnceWith(1);
        await expect(run.settled).resolves.toBe('skipped');
    });

    it('skips when the game declares no manifest', async () => {
        const { assetManager, registered } = buildManager();

        const run = startScenePreload({
            assetManager,
            assetManifest: undefined,
            requiredAssets: [ref('a')],
        });

        expect(registered).toEqual([]);
        await expect(run.settled).resolves.toBe('skipped');
    });

    it('still skips when the progress callback throws on the not-measured report', async () => {
        // Unguarded, this throw escapes `startScenePreload` itself: the call
        // never returns, so the caller is left holding no run at all — not even
        // one that resolves an outcome.
        const { assetManager } = buildManager();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [],
            onProgress: () => {
                throw new Error('a cover blew up');
            },
        });

        await expect(run.settled).resolves.toBe('skipped');
    });

    it('loads when every declared ref resolves', async () => {
        const { assetManager } = buildManager();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b'))]),
            requiredAssets: [ref('a'), ref('b')],
        });

        await expect(run.settled).resolves.toBe('loaded');
        expect(assetManager.get(ref('a'))).not.toBeNull();
        expect(assetManager.get(ref('b'))).not.toBeNull();
    });

    it('fails when one declared ref rejects', async () => {
        const { assetManager } = buildManager({ [String(ref('b'))]: 'reject' });

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b'))]),
            requiredAssets: [ref('a'), ref('b')],
        });

        await expect(run.settled).resolves.toBe('failed');
    });

    it('times out when a ref never settles', async () => {
        vi.useFakeTimers();
        const { assetManager } = buildManager({ [String(ref('a'))]: 'hang' });

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            timeoutMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        await expect(run.settled).resolves.toBe('timeout');
    });

    it('does not time out before the budget elapses', async () => {
        // Positive control for the case above: without it, a run that resolved
        // `'timeout'` immediately would pass it.
        vi.useFakeTimers();
        const { assetManager } = buildManager({ [String(ref('a'))]: 'hang' });
        const seen: ScenePreloadOutcome[] = [];

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            timeoutMs: 1_000,
        });
        void run.settled.then((outcome) => seen.push(outcome));

        await vi.advanceTimersByTimeAsync(999);
        expect(seen).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toEqual(['timeout']);
    });

    it('uses SCENE_PRELOAD_BUDGET_MS when no timeoutMs is given', async () => {
        // Every other timeout case passes an explicit `timeoutMs`, so none of
        // them can see the default binding. Advancing to one tick BEFORE the
        // budget and then onto it is what makes this about that constant rather
        // than about "some timer eventually fires".
        vi.useFakeTimers();
        const { assetManager } = buildManager({ [String(ref('a'))]: 'hang' });
        const seen: ScenePreloadOutcome[] = [];

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
        });
        void run.settled.then((outcome) => seen.push(outcome));

        await vi.advanceTimersByTimeAsync(SCENE_PRELOAD_BUDGET_MS - 1);
        expect(seen).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toEqual(['timeout']);
    });

    it('stops reporting progress once the budget has released the reveal', async () => {
        // The ref lands AFTER the timeout, which no `'hang'` fixture can
        // produce. Without this, dropping the `finished` conjunct from the
        // progress guard moves a cover's fraction for a scene that is already
        // on screen, and nothing reds.
        vi.useFakeTimers();
        const { assetManager, settleDeferred } = buildManager({
            [String(ref('a'))]: 'deferred',
        });
        const fractions: number[] = [];

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            timeoutMs: 1_000,
            onProgress: (fraction) => fractions.push(fraction),
        });

        await vi.advanceTimersByTimeAsync(1_000);
        await expect(run.settled).resolves.toBe('timeout');
        expect(fractions).toEqual([]);

        settleDeferred(ref('a'));
        await vi.advanceTimersByTimeAsync(0);

        expect(fractions).toEqual([]);
    });

    it('reports progress for a ref that lands BEFORE the budget', async () => {
        // Positive control for the case above: the deferred fixture does reach
        // the progress channel when it settles in time, so an empty `fractions`
        // there is the guard working rather than the fixture never arriving.
        vi.useFakeTimers();
        const { assetManager, settleDeferred } = buildManager({
            [String(ref('a'))]: 'deferred',
        });
        const fractions: number[] = [];

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            timeoutMs: 1_000,
            onProgress: (fraction) => fractions.push(fraction),
        });

        settleDeferred(ref('a'));
        await expect(run.settled).resolves.toBe('loaded');

        expect(fractions).toEqual([1]);
    });

    it('leaves no budget timer pending once it has settled', async () => {
        // A run that resolved without clearing its timer keeps a 5 s closure
        // alive per transition, and every one of them still fires. Invisible to
        // every outcome assertion, because `finish` drops the late call.
        vi.useFakeTimers();
        const { assetManager } = buildManager();

        await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
        }).settled;

        expect(vi.getTimerCount()).toBe(0);
    });

    it('settles on time when the progress callback itself throws', async () => {
        // `onProgress` is a game's code. It runs inside the per-ref `finally`,
        // so an escaping throw rejects the settle-all and leaves nothing to
        // resolve the run: the scene would wait out the whole budget with its
        // assets already loaded, and the rejection would float unhandled.
        vi.useFakeTimers();
        const { assetManager } = buildManager();
        const seen: ScenePreloadOutcome[] = [];

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            timeoutMs: 1_000,
            onProgress: () => {
                throw new Error('a cover blew up');
            },
        });
        void run.settled.then((outcome) => seen.push(outcome));

        // No clock advance at all: the run must be done on its own microtasks.
        await vi.advanceTimersByTimeAsync(0);

        expect(seen).toEqual(['loaded']);
    });

    it('never rejects, on the path where a ref rejects', async () => {
        // Awaited directly, with NO `.catch` and no rejects assertion: a gate
        // awaiting this is the thing standing between the player and the scene,
        // so a rethrow here would strand the reveal. Rethrowing the load error
        // turns this into an unhandled rejection.
        const { assetManager } = buildManager({
            [String(ref('a'))]: 'reject',
            [String(ref('b'))]: 'reject',
        });

        const outcome = await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b'))]),
            requiredAssets: [ref('a'), ref('b')],
        }).settled;

        expect(outcome).toBe('failed');
    });

    it('never rejects, on the path where a ref is undeclared', async () => {
        // `AssetManager.load` rejects an undeclared ref with
        // UnknownAssetManifestEntryError. Invariant #52 makes validate-assets
        // the standing guard for declaration, so this run counts it as one
        // failed ref and reports it — it does not throw.
        const { assetManager } = buildManager();

        const outcome = await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a'), ref('undeclared')],
        }).settled;

        expect(outcome).toBe('failed');
    });
});

// ── settle-all ────────────────────────────────────────────────────────────────

describe('startScenePreload settles every ref', () => {
    it('loads the later refs even when the first one rejects', () => {
        // A sequential `for … await` with no per-ref catch abandons the rest of
        // the list at the first bad ref, releasing the reveal with everything
        // after it unloaded — the pop-in this gate exists to remove.
        const { assetManager } = buildManager({ [String(ref('a'))]: 'reject' });

        return startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b')), entry(ref('c'))]),
            requiredAssets: [ref('a'), ref('b'), ref('c')],
        }).settled.then(() => {
            expect(assetManager.get(ref('a'))).toBeNull();
            expect(assetManager.get(ref('b'))).not.toBeNull();
            expect(assetManager.get(ref('c'))).not.toBeNull();
        });
    });
});

// ── the manifest handed to registerManifest ───────────────────────────────────

describe('startScenePreload promotes the whole manifest', () => {
    it('hands registerManifest an object with the input manifest’s entry count', () => {
        // The sub-manifest mutant: filtering to the scene's own refs would make
        // this 2 instead of 4, and would evict every ref absent from it.
        const { assetManager, registered } = buildManager();
        const full = manifest([entry(ref('a')), entry(ref('b')), entry(ref('c')), entry(ref('d'))]);

        startScenePreload({
            assetManager,
            assetManifest: full,
            requiredAssets: [ref('a'), ref('b')],
        });

        expect(registered).toHaveLength(1);
        expect(registered[0]?.entries).toHaveLength(full.entries.length);
        expect(registered[0]?.gameId).toBe(full.gameId);
    });

    it('promotes exactly the scene’s refs to critical, leaving the rest alone', () => {
        const { assetManager, registered } = buildManager();

        startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b')), entry(ref('c'))]),
            requiredAssets: [ref('b')],
        });

        const byRef = new Map(registered[0]?.entries.map((e) => [String(e.ref), e.priority]));
        expect(byRef.get(String(ref('a')))).toBe('deferred');
        expect(byRef.get(String(ref('b')))).toBe('critical');
        expect(byRef.get(String(ref('c')))).toBe('deferred');
    });

    it('does not evict an already-cached ref it is about to promote', async () => {
        // Identity, not non-nullness: a promoted entry that stopped comparing
        // equivalent would be evicted and then re-fetched by this very run, so
        // `get` would still answer — with a DIFFERENT object.
        //
        // MEASURED: the rewrite that looks like the eviction hazard,
        // `{ ...entry, metadata: entry.metadata, priority: 'critical' }`, does
        // NOT break equivalence. `assetManifestEntryEquivalent` falls through to
        // `JSON.stringify(a.metadata) === JSON.stringify(b.metadata)`, and both
        // sides are `undefined` for an entry that declares none. A rewrite that
        // changes the VALUE (`metadata: {}`) is the live one, and is what this
        // case kills.
        const { assetManager } = buildManager();
        const full = manifest([entry(ref('a')), entry(ref('b'))]);
        assetManager.registerManifest(full);
        await assetManager.load(ref('a'));
        const beforeRun = assetManager.get(ref('a'));
        expect(beforeRun).not.toBeNull();

        await startScenePreload({
            assetManager,
            assetManifest: full,
            requiredAssets: [ref('a')],
        }).settled;

        expect(assetManager.get(ref('a'))).toBe(beforeRun);
    });

    it('leaves a non-required, already-cached ref resolvable afterwards', async () => {
        // The consequence the entry-count assertion above is a proxy for, read
        // through the manager's own cache rather than through the argument.
        const { assetManager } = buildManager();
        const full = manifest([entry(ref('a')), entry(ref('cached'))]);
        assetManager.registerManifest(full);
        await assetManager.load(ref('cached'));
        expect(assetManager.get(ref('cached'))).not.toBeNull();

        await startScenePreload({
            assetManager,
            assetManifest: full,
            requiredAssets: [ref('a')],
        }).settled;

        expect(assetManager.get(ref('cached'))).not.toBeNull();
    });
});

// ── progress ──────────────────────────────────────────────────────────────────

describe('startScenePreload progress', () => {
    it("counts over the scene's own refs, not over the manifest's critical entries", async () => {
        // Ten critical entries, two of them the scene's. Delegating to
        // `preloadCritical`'s fraction would report over all ten and jump to
        // 10/12-shaped values in one microtask; a game authors its cover
        // against whatever this fraction means.
        const { assetManager } = buildManager();
        const entries = [
            ...Array.from({ length: 10 }, (_unused, index) =>
                entry(ref(`critical-${String(index)}`), 'critical'),
            ),
            entry(ref('a')),
            entry(ref('b')),
        ];
        const fractions: number[] = [];

        await startScenePreload({
            assetManager,
            assetManifest: manifest(entries),
            requiredAssets: [ref('a'), ref('b')],
            onProgress: (fraction) => fractions.push(fraction),
        }).settled;

        expect(fractions).toEqual([0.5, 1]);
    });

    it('counts a rejected ref as settled', async () => {
        // Otherwise a scene with one bad ref never reaches 1 and a cover reading
        // the fraction sits at a fraction of a wait that is over.
        const { assetManager } = buildManager({ [String(ref('a'))]: 'reject' });
        const fractions: number[] = [];

        await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b'))]),
            requiredAssets: [ref('a'), ref('b')],
            onProgress: (fraction) => fractions.push(fraction),
        }).settled;

        expect(fractions).toEqual([0.5, 1]);
    });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe('startScenePreload cancel', () => {
    it('suppresses the progress callback', async () => {
        const { assetManager } = buildManager();
        const onProgress = vi.fn();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
            onProgress,
        });
        run.cancel();
        await run.settled;

        expect(onProgress).not.toHaveBeenCalled();
    });

    it('suppresses the error report, and a post-cancel rejection emits nothing', async () => {
        // The half a cancel that only stopped the progress channel would leave
        // alive: the load still rejects, and the report still fires.
        const { entries } = captureEmits();
        const { assetManager } = buildManager({ [String(ref('a'))]: 'reject' });

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
        });
        run.cancel();
        await run.settled;

        expect(entries).toEqual([]);
    });

    it('is idempotent, and a cancelled run still resolves', async () => {
        const { assetManager } = buildManager();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
        });
        run.cancel();
        run.cancel();

        await expect(run.settled).resolves.toBe('loaded');
    });

    it('is a no-op on a skipped run', async () => {
        const { assetManager } = buildManager();

        const run = startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [],
        });

        expect(() => {
            run.cancel();
        }).not.toThrow();
        await expect(run.settled).resolves.toBe('skipped');
    });
});

// ── the error report ──────────────────────────────────────────────────────────

describe('startScenePreload error reporting', () => {
    it('reports once for a run, however many refs failed', async () => {
        // Three broken refs are one broken declaration, not three log lines.
        const { entries } = captureEmits();
        const { assetManager } = buildManager({
            [String(ref('a'))]: 'reject',
            [String(ref('b'))]: 'reject',
            [String(ref('c'))]: 'reject',
        });

        await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a')), entry(ref('b')), entry(ref('c'))]),
            requiredAssets: [ref('a'), ref('b'), ref('c')],
        }).settled;

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            level: 'error',
            source: { process: 'renderer', module: 'scene-preload' },
            context: { gameId: 'tactics' },
        });
    });

    it('reports nothing when every ref resolves', async () => {
        const { entries } = captureEmits();
        const { assetManager } = buildManager();

        await startScenePreload({
            assetManager,
            assetManifest: manifest([entry(ref('a'))]),
            requiredAssets: [ref('a')],
        }).settled;

        expect(entries).toEqual([]);
    });
});
