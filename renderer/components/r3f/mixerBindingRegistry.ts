/**
 * renderer/components/r3f/mixerBindingRegistry.ts
 *
 * Per-root registry of the Canvas-bound animation hooks that own an
 * `AnimationMixer`. Rule ONE-MIXER-PER-ROOT: a model root carries exactly one
 * of them.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * A second hook on the same root is a wiring mistake with no loud symptom:
 * each owns its own mixer, each advances it once per frame, and the two
 * mixers drive the SAME action cache — so the clip runs at double speed and
 * `MeshClipBackend`, which derives a playback's wrap count from the deltas
 * that came through its own `advance`, miscounts every wrap. The engine
 * therefore REPORTS it — logged, not thrown, per the FrameloopWiringError
 * conventions (`FrameRateLimiter.tsx`'s header records why a canvas-adjacent
 * failure must not throw; R3F's `ErrorBoundary` re-throws outward past the
 * `<Canvas>`, Invariant #67).
 *
 * The report is deferred one frame and cancelled when the root's count returns
 * to ≤1 first, so a pair that overlaps and then resolves is not reported — the
 * cancel case in `__tests__/one-mixer-per-root.test.tsx`. A StrictMode remount
 * is NOT such a pair: React runs a remount's cleanup before its re-setup, so
 * the count never transiently exceeds one. Measured `['setup', 'cleanup',
 * 'setup']` on the installed React; the same measurement is recorded for
 * `mainCanvasRegistry` in the M10 roadmap section.
 *
 * **A claim/release ledger, not a `WeakSet` of seen roots.** A set that is
 * never released cannot tell a rebind from a duplicate: the StrictMode double
 * mount would be reported as one, silently — `emitRendererError` is
 * `logsApi?.emit`, and under vitest the emitter comes from an absent
 * `globalThis.__chimera.logs`, so nothing would go red.
 *
 * Shape mirrored verbatim from `mainCanvasRegistry.ts`, which sits beside it and
 * solves the same problem one axis narrower (one process, not one root). Not
 * exported from the r3f barrel, or from any other: `useOwnedMixer` is the only
 * production caller.
 */

import type { Object3D } from 'three';

import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'mixer-binding';

/** Names a model root that carries more than one mixer-owning hook. */
class DuplicateMixerBindingError extends Error {
    constructor(binderCount: number, binderNames: readonly string[]) {
        super(
            `${binderCount} animation hooks are bound to one model root ` +
                `(${binderNames.join(', ')}), so each advances its own AnimationMixer over the ` +
                `same actions every frame — the clip plays at a multiple of its speed and every ` +
                `wrap is miscounted. A model uses exactly ONE of useModelAnimation and ` +
                `useClipPlayer.`,
        );
        this.name = 'DuplicateMixerBindingError';
    }
}

/** What the registry holds for one root while at least one hook is bound to it. */
interface MixerBindingEntry {
    count: number;
    binders: string[];
    reportHandle: number | null;
}

/**
 * Keyed by the root itself and weak, so a model instance dropped without its
 * cleanup running — a torn-down tree, a failed commit — takes its entry with it
 * rather than pinning the root's whole subtree for the life of the process.
 */
const bindingsByRoot = new WeakMap<Object3D, MixerBindingEntry>();

/**
 * Claims `root` for `binderName`; returns the release for the unmount cleanup.
 * Reports (once, deferred, naming every live binder) when more than one hook
 * holds the root at the moment the deferral fires.
 */
export function registerMixerBinding(root: Object3D, binderName: string): () => void {
    const entry: MixerBindingEntry = bindingsByRoot.get(root) ?? {
        count: 0,
        binders: [],
        reportHandle: null,
    };
    entry.count += 1;
    entry.binders.push(binderName);
    bindingsByRoot.set(root, entry);

    if (entry.count > 1 && entry.reportHandle === null) {
        entry.reportHandle = requestAnimationFrame(() => {
            entry.reportHandle = null;
            emitRendererError(
                readRendererLogsApi(),
                '[useOwnedMixer] more than one animation hook is bound to one model root',
                new DuplicateMixerBindingError(entry.count, entry.binders),
                undefined,
                LOG_MODULE,
            );
        });
    }

    let released = false;
    return () => {
        // React calls a cleanup exactly once, but a double release must not
        // free a second slot — the count would drift and a real duplicate
        // would never report again.
        if (released) {
            return;
        }
        released = true;
        entry.count -= 1;
        const index = entry.binders.indexOf(binderName);
        if (index !== -1) {
            entry.binders.splice(index, 1);
        }
        if (entry.count <= 1 && entry.reportHandle !== null) {
            cancelAnimationFrame(entry.reportHandle);
            entry.reportHandle = null;
        }
        if (entry.count === 0) {
            // Deleted rather than left at zero, so a later bind on this root is
            // a first bind and not the tail of a stale ledger.
            bindingsByRoot.delete(root);
        }
    };
}

/**
 * The registry's view of `root`, or `null` when it holds no entry.
 *
 * Exists so the zero-count DELETION above is observable: a lingering zero-count
 * entry and a deleted one behave identically at every other seam, so nothing
 * else could tell a leaking ledger from a clean one. Read by tests only; no
 * production code calls it.
 */
export function readMixerBinding(
    root: Object3D,
): { readonly count: number; readonly binders: readonly string[] } | null {
    const entry = bindingsByRoot.get(root);
    return entry === undefined ? null : { count: entry.count, binders: [...entry.binders] };
}
