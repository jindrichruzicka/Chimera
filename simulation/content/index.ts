// simulation/content/index.ts
// Public surface of the simulation/content package.
// Each task adds its exports here as the F05 work progresses.

export { type DataObject, type DataRef, MalformedRefError, buildRef, parseRef } from './DataRef';

export {
    type AssetKind,
    type AssetRef,
    type TextureAsset,
    type AudioClipAsset,
    type GLTFModelAsset,
    type SpriteSheetAsset,
    type ParticleConfigAsset,
    type AssetPriority,
    type AssetManifestEntry,
    type AssetManifest,
    MalformedAssetRefError,
    buildAssetRef,
    parseAssetRef,
} from './AssetRef';

export {
    type ContentDatabase,
    type ContentCollection,
    ContentConflictError,
    ContentSchemaError,
    UnknownDataRefError,
    createContentDatabase,
} from './ContentDatabase';

export {
    type ContentSource,
    type ContentLoadOptions,
    type ContentLoader,
    createContentLoader,
} from './ContentLoader';
