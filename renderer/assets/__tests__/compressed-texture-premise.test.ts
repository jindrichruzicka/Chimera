/**
 * renderer/assets/__tests__/compressed-texture-premise.test.ts
 *
 * §4.10 records a decision: the engine does NOT load GPU-compressed textures,
 * and the reason is that three's `KTX2Loader` cannot work without the WebGL
 * renderer, which the asset layer has no way to reach.
 *
 * This file holds the premises of that decision against the installed three, so
 * the decision is measured rather than remembered. If a later version changes
 * one, its case reds and the decision is worth reopening — which is the only way
 * a recorded "not yet" stays honest as its reasons age.
 *
 * Two premises are held. The first is the obstacle itself: `detectSupport`. The
 * second is why packaging was NOT the obstacle: a transcoder that compiles from
 * bytes it was handed needs no `.wasm` content-type row. Everything is read from
 * the installed `three` — its own `KTX2Loader`, and the transcoder files resolved
 * from this package — so each case measures whichever version is installed.
 *
 * It pins nothing about Chimera's own code: there is no compressed-texture
 * surface for a test to reach.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { LoadingManager } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * three's `FileLoader` dispatches a `ProgressEvent`, which the browser has and
 * the vitest node environment does not.
 */
class StubProgressEvent {
    constructor(
        public readonly type: string,
        public readonly init?: unknown,
    ) {}
}
(globalThis as Record<string, unknown>)['ProgressEvent'] ??= StubProgressEvent;

const requireFromRenderer = createRequire(import.meta.url);

/** A file of the Basis transcoder three ships, read from the installed package. */
function installedBasisFile(name: 'basis_transcoder.js' | 'basis_transcoder.wasm'): Buffer {
    return readFileSync(requireFromRenderer.resolve(`three/examples/jsm/libs/basis/${name}`));
}

function dataUrl(bytes: Buffer): string {
    return `data:application/octet-stream;base64,${bytes.toString('base64')}`;
}

function sameBytes(actual: unknown, expected: Buffer): boolean {
    if (actual instanceof ArrayBuffer) {
        return Buffer.from(actual).equals(expected);
    }
    if (ArrayBuffer.isView(actual)) {
        return Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).equals(expected);
    }
    return false;
}

/**
 * A global scope shaped like a worker's, and the calls a transcoder could make
 * to get its binary.
 *
 * A fresh `vm` context rather than this file's own scope, because Emscripten
 * decides it is in Node from `process`, and its Node branch never streams
 * whatever it is handed — so "did not stream" would hold here for a reason that
 * has nothing to do with the bytes. `importScripts` is what makes it take
 * itself for a worker, which is where `KTX2Loader` runs it.
 */
function createWorkerScope(): {
    readonly scope: Record<string, unknown>;
    readonly fetched: ReturnType<typeof vi.fn>;
    readonly streamed: ReturnType<typeof vi.fn>;
    readonly compiled: ReturnType<typeof vi.fn>;
    readonly messageListeners: ((event: { readonly data: unknown }) => void)[];
} {
    const wasm = installedBasisFile('basis_transcoder.wasm');
    // Answers like a served file, so the streaming branch — when it is taken —
    // goes on to hand the response to `instantiateStreaming`.
    const fetched = vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () =>
            wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    }));
    const streamed = vi.fn(async () => {
        throw new Error('streamed instantiation');
    });
    const compiled = vi.fn((bytes: BufferSource, imports?: WebAssembly.Imports) =>
        WebAssembly.instantiate(bytes, imports),
    );
    const webAssembly = new Proxy(WebAssembly, {
        get(target, key) {
            if (key === 'instantiateStreaming') return streamed;
            if (key === 'instantiate') return compiled;
            return Reflect.get(target, key) as unknown;
        },
    });
    const messageListeners: ((event: { readonly data: unknown }) => void)[] = [];
    const quiet = (): void => undefined;
    const scope: Record<string, unknown> = {
        importScripts: (): void => undefined,
        fetch: fetched,
        WebAssembly: webAssembly,
        location: { href: 'blob:probe' },
        console: { log: quiet, warn: quiet, error: quiet },
        TextDecoder,
        setTimeout,
        clearTimeout,
        addEventListener: (type: string, listener: (event: { readonly data: unknown }) => void) => {
            if (type === 'message') messageListeners.push(listener);
        },
        postMessage: (): void => undefined,
    };
    scope['self'] = scope;
    createContext(scope);
    return { scope, fetched, streamed, compiled, messageListeners };
}

/** Stands in for the `Worker` a `KTX2Loader` constructs, keeping what it is posted. */
class ProbeWorker {
    static readonly built: ProbeWorker[] = [];
    readonly posted: unknown[] = [];

    constructor(readonly url: string) {
        ProbeWorker.built.push(this);
    }

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    addEventListener(): void {}

    terminate(): void {}
}

afterEach(() => {
    ProbeWorker.built.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the premise behind §4.10's compressed-texture decision", () => {
    it('refuses to load without a renderer handed to detectSupport', () => {
        // The asset layer builds its loaders in `createDefaultAssetLoaderRegistry`,
        // reached from managers built outside any canvas (Invariant #21 enumerates
        // their owners) — and in a game that mounts none, no `WebGLRenderer` is
        // ever created at all. So this throw is not a detail of initialisation
        // order; it is a dependency the asset layer cannot satisfy where it lives.
        const loader = new KTX2Loader();

        expect(() => loader.load('chimera://renderer/game-assets/x/t.ktx2', () => {})).toThrow(
            /detectSupport/u,
        );
    });

    it('refuses to parse bytes it already holds, for the same reason', () => {
        // Which rules out the obvious workaround of fetching the file through the
        // engine's own path and handing three only the buffer: the renderer is
        // required to choose a transcode TARGET, so it is needed before any byte
        // is decoded, not merely before one is fetched.
        const loader = new KTX2Loader();

        expect(() => loader.parse(new ArrayBuffer(8), () => {})).toThrow(/detectSupport/u);
    });

    it('hands the transcoder its binary as bytes, which it compiles without fetching or streaming', async () => {
        // `load` and `parse` refuse before they reach `init()`, but `init()` itself
        // runs without `detectSupport`: it fetches the transcoder and registers the
        // worker that will run it. The worker is only built when a task is
        // posted, so one is.
        const wasm = installedBasisFile('basis_transcoder.wasm');
        const manager = new LoadingManager();
        manager.setURLModifier((url) =>
            dataUrl(
                installedBasisFile(
                    url.endsWith('.wasm') ? 'basis_transcoder.wasm' : 'basis_transcoder.js',
                ),
            ),
        );
        const createObjectURL = vi.spyOn(URL, 'createObjectURL');
        vi.stubGlobal('Worker', ProbeWorker);
        const loader = new KTX2Loader(manager).setTranscoderPath('probe://basis/');

        await loader.init();
        void loader.workerPool.postMessage({ type: 'probe' }, []);

        // What the loader SENDS: the binary, as bytes, in the worker's init message.
        const init = ProbeWorker.built[0]?.posted[0] as
            | { readonly type: string; readonly transcoderBinary: unknown }
            | undefined;
        expect(init?.type).toBe('init');
        expect(sameBytes(init?.transcoderBinary, wasm)).toBe(true);

        // What the worker DOES with them: the source it was built from, run in a
        // worker-shaped scope and handed that same message.
        const workerSource = createObjectURL.mock.calls[0]?.[0];
        expect(workerSource).toBeInstanceOf(Blob);
        const worker = createWorkerScope();
        runInContext(await (workerSource as Blob).text(), worker.scope);
        for (const listener of worker.messageListeners) {
            listener({ data: init });
        }
        await vi.waitFor(() => {
            expect(worker.compiled).toHaveBeenCalled();
        });
        await worker.compiled.mock.results[0]?.value;

        expect(sameBytes(worker.compiled.mock.calls[0]?.[0], wasm)).toBe(true);
        expect(worker.fetched).not.toHaveBeenCalled();
        expect(worker.streamed).not.toHaveBeenCalled();

        loader.dispose();
    });

    it('streams in that same scope when no binary is handed over', async () => {
        // The control for the case above: without it, "never streamed" could just
        // as well mean this scope cannot observe a stream at all.
        const worker = createWorkerScope();

        runInContext(
            `${installedBasisFile('basis_transcoder.js').toString('utf8')}\nBASIS({}).catch(() => {});`,
            worker.scope,
        );
        await vi.waitFor(() => {
            expect(worker.streamed).toHaveBeenCalled();
        });

        expect(worker.fetched).toHaveBeenCalled();
    });
});
