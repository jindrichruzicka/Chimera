import type {
    AssetKind,
    AssetKindId,
    AssetRef,
} from '@chimera-engine/simulation/content/AssetRef.js';

export interface AssetLoadRequest<TAssetKind extends AssetKind = AssetKind> {
    readonly ref: AssetRef<TAssetKind>;
    readonly kind: AssetKindId<TAssetKind>;
    readonly url: string;
    readonly metadata?: unknown;
}

export interface AssetLoader<TAssetKind extends AssetKind = AssetKind, TLoadedAsset = unknown> {
    readonly kind: AssetKindId<TAssetKind>;
    load(request: AssetLoadRequest<TAssetKind>): Promise<TLoadedAsset>;
}

export interface AssetLoaderRegistry {
    register<TAssetKind extends AssetKind>(loader: AssetLoader<TAssetKind>): void;
    get<TAssetKind extends AssetKind>(kind: AssetKindId<TAssetKind>): AssetLoader<TAssetKind>;
    has(kind: string): boolean;
}

export class DuplicateAssetLoaderError extends Error {
    constructor(public readonly kind: string) {
        super(`Asset loader already registered for kind '${kind}'.`);
        this.name = 'DuplicateAssetLoaderError';
    }
}

export class UnknownAssetKindError extends Error {
    constructor(public readonly kind: string) {
        super(`No asset loader registered for kind '${kind}'.`);
        this.name = 'UnknownAssetKindError';
    }
}

class DefaultAssetLoaderRegistry implements AssetLoaderRegistry {
    private readonly loaders = new Map<string, AssetLoader>();

    constructor(loaders: readonly AssetLoader[] = []) {
        for (const loader of loaders) {
            this.register(loader);
        }
    }

    register<TAssetKind extends AssetKind>(loader: AssetLoader<TAssetKind>): void {
        const kind = loader.kind;
        if (this.loaders.has(kind)) {
            throw new DuplicateAssetLoaderError(kind);
        }
        this.loaders.set(kind, loader);
    }

    get<TAssetKind extends AssetKind>(kind: AssetKindId<TAssetKind>): AssetLoader<TAssetKind> {
        const loader = this.loaders.get(kind);
        if (loader === undefined) {
            throw new UnknownAssetKindError(kind);
        }
        return loader as AssetLoader<TAssetKind>;
    }

    has(kind: string): boolean {
        return this.loaders.has(kind);
    }
}

export function createAssetLoaderRegistry(
    loaders: readonly AssetLoader[] = [],
): AssetLoaderRegistry {
    return new DefaultAssetLoaderRegistry(loaders);
}
