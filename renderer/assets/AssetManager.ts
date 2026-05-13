import { TextureLoader } from 'three';
import type { Texture } from 'three';

import type {
    AssetKind,
    AssetRef,
    AudioClipAsset,
    GLTFModelAsset,
    ParticleConfigAsset,
    SpriteSheetAsset,
    TextureAsset,
} from '@chimera/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera/simulation/content/AssetManifest.js';

import type { AssetResolver } from './AssetResolver';

export interface LoadedGltfAsset {
    readonly scene?: unknown;
    readonly scenes?: readonly unknown[];
    readonly animations?: readonly unknown[];
    readonly dispose?: () => void;
}

export interface LoadedSpriteSheetAsset {
    readonly texture: Texture;
    readonly frames?: Readonly<Record<string, unknown>>;
    readonly dispose?: () => void;
}

export type LoadedAudioClipAsset = unknown;
export type LoadedParticleConfigAsset = unknown;

export type ResolvedAsset<TAssetKind extends AssetKind = AssetKind> =
    TAssetKind extends TextureAsset
        ? Texture
        : TAssetKind extends GLTFModelAsset
          ? LoadedGltfAsset
          : TAssetKind extends SpriteSheetAsset
            ? LoadedSpriteSheetAsset
            : TAssetKind extends AudioClipAsset
              ? LoadedAudioClipAsset
              : TAssetKind extends ParticleConfigAsset
                ? LoadedParticleConfigAsset
                : unknown;

export interface AssetManager {
    preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
    ): Promise<void>;
    get<TAssetKind extends AssetKind>(ref: AssetRef<TAssetKind>): ResolvedAsset<TAssetKind> | null;
    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>>;
    dispose(): void;
}

export interface AssetLoader {
    load(url: string, ref: AssetRef): Promise<ResolvedAsset>;
}

export class DefaultAssetManager implements AssetManager {
    private readonly loadedAssets = new Map<string, ResolvedAsset>();
    private readonly inFlightLoads = new Map<string, Promise<ResolvedAsset>>();
    private cacheGeneration = 0;

    constructor(
        private readonly resolver: AssetResolver,
        private readonly loader: AssetLoader = new DefaultAssetLoader(),
    ) {}

    async preloadCritical(
        manifest: AssetManifest,
        onProgress?: (fraction: number) => void,
    ): Promise<void> {
        const criticalEntries = manifest.entries.filter((entry) => entry.priority === 'critical');

        if (criticalEntries.length === 0) {
            onProgress?.(1);
            return;
        }

        let completed = 0;
        for (const entry of criticalEntries) {
            await this.load(entry.ref);
            completed += 1;
            onProgress?.(completed / criticalEntries.length);
        }
    }

    get<TAssetKind extends AssetKind>(ref: AssetRef<TAssetKind>): ResolvedAsset<TAssetKind> | null {
        const asset = this.loadedAssets.get(ref);
        return asset === undefined ? null : (asset as ResolvedAsset<TAssetKind>);
    }

    load<TAssetKind extends AssetKind>(
        ref: AssetRef<TAssetKind>,
    ): Promise<ResolvedAsset<TAssetKind>> {
        const key = ref.toString();
        const cachedAsset = this.loadedAssets.get(key);
        if (cachedAsset !== undefined) {
            return Promise.resolve(cachedAsset as ResolvedAsset<TAssetKind>);
        }

        const inFlightLoad = this.inFlightLoads.get(key);
        if (inFlightLoad !== undefined) {
            return inFlightLoad as Promise<ResolvedAsset<TAssetKind>>;
        }

        const url = this.resolver.resolve(ref);
        const loadGeneration = this.cacheGeneration;
        let rawLoad: Promise<ResolvedAsset>;
        try {
            rawLoad = this.loader.load(url, ref);
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
                return asset as ResolvedAsset<TAssetKind>;
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

        for (const asset of assets) {
            disposeAsset(asset);
        }
    }
}

export function createAssetManager(resolver: AssetResolver, loader?: AssetLoader): AssetManager {
    return new DefaultAssetManager(resolver, loader);
}

export class DefaultAssetLoader implements AssetLoader {
    async load(url: string, _ref: AssetRef): Promise<ResolvedAsset> {
        const extension = getAssetExtension(url);

        if (IMAGE_EXTENSIONS.has(extension)) {
            return loadTexture(url);
        }

        if (MODEL_EXTENSIONS.has(extension)) {
            return loadGltf(url);
        }

        if (AUDIO_EXTENSIONS.has(extension)) {
            return loadAudioClip(url);
        }

        if (extension === '.json') {
            return loadJson(url);
        }

        return loadArrayBuffer(url);
    }
}

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.ktx2', '.png', '.webp']);
const MODEL_EXTENSIONS = new Set(['.glb', '.gltf']);
const AUDIO_EXTENSIONS = new Set(['.flac', '.m4a', '.mp3', '.ogg', '.wav']);

function loadTexture(url: string): Promise<Texture> {
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

async function loadArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetchAsset(url);
    return response.arrayBuffer();
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
