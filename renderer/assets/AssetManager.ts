import type { AnimationClip, Group, Texture } from 'three';

import { isTraversalUnsafe } from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

import type {
    AssetKind,
    AssetKindId,
    AssetRef,
    AudioClipAsset,
    GLTFModelAsset,
    ParticleConfigAsset,
    SpriteSheetAsset,
    TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type {
    AssetManifest,
    AssetManifestEntry,
} from '@chimera-engine/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';
import {
    createAssetLoaderRegistry,
    type AssetLoadRequest,
    type AssetLoader,
    type AssetLoaderRegistry,
} from './AssetLoaderRegistry';

export type { AssetLoadRequest, AssetLoader, AssetLoaderRegistry } from './AssetLoaderRegistry';

/**
 * The value a `gltf-model` ref resolves to — the `GLTF` result of
 * `GLTFLoader.load`.
 *
 * The loader's runtime value also carries `cameras`, `asset`, `parser` and
 * `userData`; they are deliberately not named here. Widening this interface
 * later (naming one of them) is additive and safe, whereas narrowing a named
 * field would break every consumer — so absence means "not yet contracted",
 * not "not present".
 */
export interface LoadedGltfAsset {
    readonly scene: Group;
    readonly scenes?: readonly unknown[];
    readonly animations: readonly AnimationClip[];
    readonly dispose?: () => void;
}

export interface LoadedSpriteSheetAsset {
    readonly texture: Texture;
    readonly frames?: Readonly<Record<string, unknown>>;
    readonly dispose?: () => void;
}

export type LoadedAudioClipAsset = unknown;
export type LoadedParticleConfigAsset = unknown;

export interface ResolvedAssetRegistry {
    readonly texture: Texture;
    readonly 'gltf-model': LoadedGltfAsset;
    readonly 'sprite-sheet': LoadedSpriteSheetAsset;
    readonly 'audio-clip': LoadedAudioClipAsset;
    readonly 'particle-config': LoadedParticleConfigAsset;
}

type ResolvedAssetForKind<TAssetKindId extends string> =
    TAssetKindId extends keyof ResolvedAssetRegistry
        ? ResolvedAssetRegistry[TAssetKindId]
        : unknown;

export type ResolvedAsset<TAssetKind extends AssetKind = AssetKind> = ResolvedAssetForKind<
    AssetKindId<TAssetKind>
>;

export interface AssetManager {
    registerManifest(manifest: AssetManifest): void;
    /**
     * Warms every `critical` entry of `manifest`.
     *
     * `onEntryFailure` fires as each broken ref settles, and is the only channel
     * that reports one PROMPTLY: the run attempts every entry, so its own
     * rejection cannot arrive before the slowest of them — and one that never
     * answers would otherwise withhold the whole report.
     */
    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
        onEntryFailure?: (ref: AssetRef, error: unknown) => void,
    ): Promise<void>;
    get<TAssetKind extends AssetKind>(ref: AssetRef<TAssetKind>): ResolvedAsset<TAssetKind> | null;
    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>>;
    /**
     * Synchronously reads a registered manifest entry's opaque `metadata`,
     * verbatim, with no interpretation and no decode/load side effect. Returns
     * `undefined` when the ref is unknown or the entry declares no metadata.
     *
     * Kind-agnostic: it carries no audio (or any other domain) knowledge and
     * returns `unknown`. It will be the sole channel by which `renderer/audio`
     * reads a clip's cue sheet at `play()` time — only that layer interprets the
     * value (Invariant #124).
     */
    getManifestMetadata(ref: AssetRef): unknown;
    dispose(): void;
}

export class UnknownAssetManifestEntryError extends Error {
    constructor(public readonly ref: string) {
        super(`AssetRef '${ref}' is not declared in the active AssetManifest.`);
        this.name = 'UnknownAssetManifestEntryError';
    }
}

/**
 * What `preloadCritical` rejects with once every critical entry has settled.
 *
 * It names the refs, and carries the first underlying error as `cause` so the
 * original message and stack survive the aggregation. A caller that reports as
 * each ref settles — through `onEntryFailure` — has already named them all by
 * the time this arrives, and uses the type to recognise that.
 *
 * A rejection here still means "at least one critical ref will load on demand
 * instead" — it never means the rest were abandoned.
 */
export class CriticalAssetPreloadFailedError extends Error {
    readonly refs: readonly string[];

    constructor(failures: readonly { readonly ref: AssetRef; readonly error: unknown }[]) {
        const described = failures
            .map((failure) => `${String(failure.ref)} (${describeError(failure.error)})`)
            .join(', ');
        super(`${failures.length} critical asset(s) failed to preload: ${described}.`, {
            cause: failures[0]?.error,
        });
        this.name = 'CriticalAssetPreloadFailedError';
        this.refs = failures.map((failure) => String(failure.ref));
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A game can pass this callback through the public `AssetManager` interface. In
 * the loop below, an escaping throw abandons every critical entry after the one
 * being reported — the pop-in `priority: 'critical'` exists to prevent — and
 * rejects with the reporter's error instead of the refs that failed. On the
 * empty-list return, a throw rejects a run that had nothing to load. Swallowed
 * per call, so a reporter that breaks once still hears the rest of the run.
 */
function reportPreloadProgress(
    onProgress: ((fraction: number) => void) | undefined,
    fraction: number,
): void {
    try {
        onProgress?.(fraction);
    } catch {
        // Intentionally swallowed; see above.
    }
}

export class DefaultAssetManager implements AssetManager {
    private readonly loadedAssets = new Map<string, unknown>();
    private readonly inFlightLoads = new Map<string, Promise<unknown>>();
    private readonly manifestEntries = new Map<string, AssetManifestEntry>();
    private cacheGeneration = 0;

    constructor(
        private readonly resolver: AssetResolver,
        private readonly loaderRegistry: AssetLoaderRegistry = createDefaultAssetLoaderRegistry(),
        manifest?: AssetManifest,
    ) {
        if (manifest !== undefined) {
            this.registerManifest(manifest);
        }
    }

    registerManifest(manifest: AssetManifest): void {
        // Build the new index first — without mutating state — so we can compare.
        const newEntriesByRef = new Map<string, AssetManifestEntry>();
        for (const entry of manifest.entries) {
            newEntriesByRef.set(entry.ref, entry);
        }

        // Evict cache and in-flight entries for refs whose manifest entry has changed
        // (different kind or metadata) or that are absent from the new manifest.
        // Unchanged refs stay in cache to avoid redundant network fetches.
        for (const [key, oldEntry] of this.manifestEntries) {
            const newEntry = newEntriesByRef.get(key);
            if (newEntry === undefined || !assetManifestEntryEquivalent(oldEntry, newEntry)) {
                this.evictManifestEntry(key);
            }
        }

        this.manifestEntries.clear();
        for (const [key, entry] of newEntriesByRef) {
            this.manifestEntries.set(key, entry);
        }
    }

    async preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
        onEntryFailure?: (ref: AssetRef, error: unknown) => void,
    ): Promise<void> {
        this.registerManifest(manifest);
        const criticalEntries = manifest.entries.filter((entry) => entry.priority === 'critical');

        if (criticalEntries.length === 0) {
            reportPreloadProgress(onProgress, 1);
            return;
        }

        // Settle-all: every entry is ATTEMPTED, and the failures are collected
        // rather than thrown out of the loop. A run that stopped at the first
        // rejection left every entry after it to load on demand, which is the
        // pop-in `priority: 'critical'` exists to prevent.
        //
        // Still SEQUENTIAL, unlike `startScenePreload`'s concurrent settle-all:
        // the defect is the abandonment, not the sequencing, and the load order
        // this produces is observable — `criticalAssetPreload.test.tsx` pins the
        // order the gate's chained settle-all must not overtake.
        let completed = 0;
        const failures: { readonly ref: AssetRef; readonly error: unknown }[] = [];
        for (const entry of criticalEntries) {
            try {
                await this.load<AssetKind>(entry.ref);
            } catch (error: unknown) {
                failures.push({ ref: entry.ref, error });
                // Announced HERE, not at the rejection below: attempting every
                // entry means this run cannot settle before the slowest one,
                // and an entry that never answers would take the report with
                // it. A caller that only wants the outcome ignores this.
                try {
                    onEntryFailure?.(entry.ref, error);
                } catch {
                    // A reporter throwing is not a reason to abandon the rest of
                    // the list — that is the shape this loop exists to remove,
                    // and it would also replace the refs with the reporter's own
                    // error. Swallowed for the same reason the scene preload
                    // swallows its progress callback's throw.
                }
            }
            // Counted for a failure too: the fraction measures how much of the
            // list has SETTLED, so a broken ref moves it on rather than
            // stalling it one short of the end forever.
            completed += 1;
            reportPreloadProgress(onProgress, completed / criticalEntries.length);
        }

        if (failures.length > 0) {
            throw new CriticalAssetPreloadFailedError(failures);
        }
    }

    get<TAssetKind extends AssetKind>(ref: AssetRef<TAssetKind>): ResolvedAsset<TAssetKind> | null {
        const key = ref.toString();
        if (!this.manifestEntries.has(key)) {
            return null;
        }

        const asset = this.loadedAssets.get(key);
        return asset === undefined ? null : (asset as ResolvedAsset<TAssetKind>);
    }

    getManifestMetadata(ref: AssetRef): unknown {
        return this.manifestEntries.get(ref.toString())?.metadata;
    }

    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        const key = ref.toString();
        const entry = this.manifestEntries.get(key) as AssetManifestEntry<TAssetKind> | undefined;
        if (entry === undefined) {
            return Promise.reject(new UnknownAssetManifestEntryError(ref));
        }

        const cachedAsset = this.loadedAssets.get(key);
        if (cachedAsset !== undefined) {
            return Promise.resolve(cachedAsset as ResolvedAsset<TAssetKind>);
        }

        const inFlightLoad = this.inFlightLoads.get(key);
        if (inFlightLoad !== undefined) {
            return inFlightLoad as Promise<ResolvedAsset<TAssetKind>>;
        }

        const loadGeneration = this.cacheGeneration;
        let rawLoad: Promise<ResolvedAsset<TAssetKind>>;
        try {
            const url = this.resolver.resolve(ref);
            const loader = this.loaderRegistry.get<TAssetKind>(entry.kind);
            rawLoad = loader.load(createLoadRequest(ref, entry, url)) as Promise<
                ResolvedAsset<TAssetKind>
            >;
        } catch (error) {
            rawLoad = Promise.reject(toError(error));
        }

        const loadPromise: Promise<ResolvedAsset<TAssetKind>> = rawLoad
            .then((asset) => {
                if (
                    loadGeneration === this.cacheGeneration &&
                    this.inFlightLoads.get(key) === loadPromise
                ) {
                    this.loadedAssets.set(key, asset);
                } else {
                    disposeAsset(asset);
                    throw new Error('Asset load was superseded by dispose.');
                }
                return asset;
            })
            .finally(() => {
                if (this.inFlightLoads.get(key) === loadPromise) {
                    this.inFlightLoads.delete(key);
                }
            });

        this.inFlightLoads.set(key, loadPromise);
        return loadPromise;
    }

    dispose(): void {
        const assets = Array.from(this.loadedAssets.values());
        this.cacheGeneration += 1;
        this.loadedAssets.clear();
        this.inFlightLoads.clear();
        this.manifestEntries.clear();

        for (const asset of assets) {
            disposeAsset(asset);
        }
    }

    private evictManifestEntry(key: string): void {
        const loadedAsset = this.loadedAssets.get(key);
        if (loadedAsset !== undefined) {
            disposeAsset(loadedAsset);
            this.loadedAssets.delete(key);
        }
        this.inFlightLoads.delete(key);
    }
}

/**
 * Creates a `DefaultAssetManager`, optionally registering `manifest` before
 * the manager is returned. Construction-time registration exists because the
 * alternatives fail (canonical rationale — call-site comments point here):
 * a passive-effect registration is provably too late for a child's first
 * `load()`, since React flushes passive mount effects children-first and
 * `useAsset` latches the resulting `UnknownAssetManifestEntryError`
 * permanently (its effect deps never change when the manifest arrives later);
 * a render-phase `registerManifest` on a shared, already-committed manager
 * destructively evicts and disposes during a phase React may discard; and
 * `useLayoutEffect` only holds up while `useAsset` stays passive.
 * Configuring the fresh object the factory is about to return is discard-safe
 * in any React phase — it touches no shared, already-committed state.
 */
export function createAssetManager(
    resolver: AssetResolver,
    manifest?: AssetManifest,
    loaderRegistry?: AssetLoaderRegistry,
): AssetManager {
    return new DefaultAssetManager(resolver, loaderRegistry, manifest);
}

export function createDefaultAssetLoaderRegistry(): AssetLoaderRegistry {
    return createAssetLoaderRegistry([
        new TextureAssetLoader(),
        new GltfAssetLoader(),
        new SpriteSheetAssetLoader(),
        new AudioClipAssetLoader(),
        new ParticleConfigAssetLoader(),
    ]);
}

/**
 * Returns true when two manifest entries describe the same loader contract:
 * same kind AND equivalent metadata. Used by {@link DefaultAssetManager.registerManifest}
 * to decide whether a cached asset is still valid after a manifest replacement.
 *
 * Metadata comparison uses JSON serialisation — metadata is expected to be a
 * JSON-serialisable structure (atlas descriptors, compression options, etc.).
 */
function assetManifestEntryEquivalent(a: AssetManifestEntry, b: AssetManifestEntry): boolean {
    if (a.kind !== b.kind) return false;
    const aHasMetadata = Object.prototype.hasOwnProperty.call(a, 'metadata');
    const bHasMetadata = Object.prototype.hasOwnProperty.call(b, 'metadata');
    if (!aHasMetadata && !bHasMetadata) return true;
    return JSON.stringify(a.metadata) === JSON.stringify(b.metadata);
}

function createLoadRequest<TAssetKind extends AssetKind>(
    ref: AssetRef<TAssetKind>,
    entry: AssetManifestEntry<TAssetKind>,
    url: string,
): AssetLoadRequest<TAssetKind> {
    const baseRequest = {
        ref,
        kind: entry.kind as AssetKindId<TAssetKind>,
        url,
    } satisfies AssetLoadRequest<TAssetKind>;

    if (!Object.prototype.hasOwnProperty.call(entry, 'metadata')) {
        return baseRequest;
    }

    return { ...baseRequest, metadata: entry.metadata };
}

class TextureAssetLoader implements AssetLoader<TextureAsset, Texture> {
    readonly kind = 'texture' as const;

    async load(request: AssetLoadRequest<TextureAsset>): Promise<Texture> {
        return loadTexture(request.url);
    }
}

class GltfAssetLoader implements AssetLoader<GLTFModelAsset, LoadedGltfAsset> {
    readonly kind = 'gltf-model' as const;

    async load(request: AssetLoadRequest<GLTFModelAsset>): Promise<LoadedGltfAsset> {
        return loadGltf(request.url);
    }
}

class SpriteSheetAssetLoader implements AssetLoader<SpriteSheetAsset, LoadedSpriteSheetAsset> {
    readonly kind = 'sprite-sheet' as const;

    async load(request: AssetLoadRequest<SpriteSheetAsset>): Promise<LoadedSpriteSheetAsset> {
        return loadSpriteSheet(request.url);
    }
}

class AudioClipAssetLoader implements AssetLoader<AudioClipAsset, LoadedAudioClipAsset> {
    readonly kind = 'audio-clip' as const;

    async load(request: AssetLoadRequest<AudioClipAsset>): Promise<LoadedAudioClipAsset> {
        return loadAudioClip(request.url);
    }
}

class ParticleConfigAssetLoader implements AssetLoader<
    ParticleConfigAsset,
    LoadedParticleConfigAsset
> {
    readonly kind = 'particle-config' as const;

    async load(request: AssetLoadRequest<ParticleConfigAsset>): Promise<LoadedParticleConfigAsset> {
        return loadJson(request.url);
    }
}

/**
 * Loads one texture, reaching `three` through a DYNAMIC import.
 *
 * A static `import { TextureLoader } from 'three'` at the top of this file was
 * enough to put the renderer core in the always-mounted shell layout chunk: the
 * shell mounts this module's consumers unconditionally, so every exported route
 * carried it, including the boot and logo screens of a game that declares no 3D
 * surface at all.
 *
 * Behind `await import` the edge is a chunk BOUNDARY instead, and `three`
 * arrives with the first texture load — or, on a 3D route, with the r3f canvas
 * that already pulls it. Free to do here because every caller is already
 * awaiting: `AssetLoader.load` returns a promise by contract, so the extra
 * module-load tick lands inside a wait the caller performs anyway.
 *
 * This is the shape `loadGltf` below has always had for `GLTFLoader`. Which
 * consumers reach this module, and that neither loader's edge is a static one,
 * are measured by `renderer/__tests__/shell-layout-graph-census.test.ts`.
 */
async function loadTexture(url: string): Promise<Texture> {
    const { TextureLoader } = await import('three');
    const loader = new TextureLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
    });
}

async function loadGltf(url: string): Promise<LoadedGltfAsset> {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => {
        loader.load(url, (gltf) => resolve(gltf), undefined, reject);
    });
}

async function loadSpriteSheet(url: string): Promise<LoadedSpriteSheetAsset> {
    const extension = getAssetExtension(url);
    if (extension === '.json') {
        const atlas = readSpriteSheetAtlas(await loadJson(url), url);
        const spriteSheet = {
            texture: await loadTexture(resolveRelativeAssetUrl(url, atlas.image)),
        };
        return atlas.frames === undefined ? spriteSheet : { ...spriteSheet, frames: atlas.frames };
    }

    return { texture: await loadTexture(url) };
}

interface SpriteSheetAtlasData {
    readonly image: string;
    readonly frames?: Readonly<Record<string, unknown>>;
}

function readSpriteSheetAtlas(value: unknown, url: string): SpriteSheetAtlasData {
    if (!isRecord(value)) {
        throw new Error(`Sprite sheet atlas '${url}' must be a JSON object.`);
    }

    const meta = value['meta'];
    if (!isRecord(meta) || typeof meta['image'] !== 'string' || meta['image'].length === 0) {
        throw new Error(`Sprite sheet atlas '${url}' must declare meta.image.`);
    }

    const imagePath = meta['image'];
    if (isTraversalUnsafe('atlas', imagePath)) {
        throw new Error(
            `Sprite sheet atlas '${url}' declares traversal-unsafe meta.image '${imagePath}'.`,
        );
    }

    const frames = value['frames'];
    if (frames === undefined) {
        return { image: imagePath };
    }

    if (!isRecord(frames)) {
        throw new Error(`Sprite sheet atlas '${url}' must declare frames as an object.`);
    }

    return { image: imagePath, frames };
}

function resolveRelativeAssetUrl(baseUrl: string, assetPath: string): string {
    try {
        return new URL(assetPath, baseUrl).toString();
    } catch {
        const baseWithoutQuery = baseUrl.split(/[?#]/, 1)[0] ?? baseUrl;
        const lastSlash = baseWithoutQuery.lastIndexOf('/');
        if (lastSlash === -1) {
            return assetPath;
        }
        return `${baseWithoutQuery.slice(0, lastSlash + 1)}${assetPath}`;
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadAudioClip(url: string): Promise<unknown> {
    const response = await fetchAsset(url);
    const data = await response.arrayBuffer();
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
        return data;
    }

    const context = new AudioContextConstructor();
    try {
        return await context.decodeAudioData(data);
    } finally {
        await context.close?.();
    }
}

async function loadJson(url: string): Promise<unknown> {
    const response = await fetchAsset(url);
    return response.json();
}

async function fetchAsset(url: string): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load asset '${url}': ${response.status} ${response.statusText}`);
    }
    return response;
}

function getAssetExtension(url: string): string {
    const path = url.split(/[?#]/, 1)[0] ?? url;
    const lastSlash = path.lastIndexOf('/');
    const lastDot = path.lastIndexOf('.');

    if (lastDot <= lastSlash) {
        return '';
    }

    return path.slice(lastDot).toLowerCase();
}

interface AudioDecoder {
    decodeAudioData(data: ArrayBuffer): Promise<unknown>;
    close?: () => Promise<void>;
}

type AudioContextFactory = new () => AudioDecoder;

function getAudioContextConstructor(): AudioContextFactory | null {
    const audioGlobal = globalThis as typeof globalThis & {
        readonly AudioContext?: AudioContextFactory;
        readonly webkitAudioContext?: AudioContextFactory;
    };
    return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext ?? null;
}

interface DisposableResource {
    dispose(): void;
}

interface TraversableResource {
    traverse(visitor: (child: unknown) => void): void;
}

const TRAVERSABLE_SKIPPED_PROPERTY_NAMES = new Set(['children', 'metadata', 'parent', 'userData']);

function disposeAsset(asset: unknown): void {
    disposeAssetRecursive(asset, new WeakSet<object>());
}

function disposeAssetRecursive(asset: unknown, visited: WeakSet<object>): void {
    if (isTraversableResource(asset)) {
        disposeTraversableResource(asset, visited);
        return;
    }

    disposeAssetObject(asset, visited);
}

function disposeTraversableResource(asset: TraversableResource, visited: WeakSet<object>): void {
    try {
        asset.traverse((child) =>
            disposeAssetObject(child, visited, TRAVERSABLE_SKIPPED_PROPERTY_NAMES),
        );
    } catch {
        // Ignore traversal failures for the same teardown guarantee.
    }

    disposeAssetObject(asset, visited, TRAVERSABLE_SKIPPED_PROPERTY_NAMES);
}

function disposeAssetObject(
    asset: unknown,
    visited: WeakSet<object>,
    skippedPropertyNames?: ReadonlySet<string>,
): void {
    if (typeof asset !== 'object' || asset === null) {
        return;
    }

    if (visited.has(asset)) {
        return;
    }
    visited.add(asset);

    if (isDisposableResource(asset)) {
        try {
            asset.dispose();
        } catch {
            // Disposal is best-effort; session teardown must remain no-throw.
        }
    }

    if (Array.isArray(asset)) {
        for (const value of asset) {
            disposeAssetRecursive(value, visited);
        }
        return;
    }

    for (const [propertyName, value] of Object.entries(asset as Record<string, unknown>)) {
        if (skippedPropertyNames?.has(propertyName) === true) {
            continue;
        }
        disposeAssetRecursive(value, visited);
    }
}

function isDisposableResource(value: unknown): value is DisposableResource {
    return (
        typeof value === 'object' &&
        value !== null &&
        'dispose' in value &&
        typeof (value as { readonly dispose?: unknown }).dispose === 'function'
    );
}

function isTraversableResource(value: unknown): value is TraversableResource {
    return (
        typeof value === 'object' &&
        value !== null &&
        'traverse' in value &&
        typeof (value as { readonly traverse?: unknown }).traverse === 'function'
    );
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
