// simulation/content/index.ts
// Public surface of the simulation/content package.

export { type DataObject, type DataRef, MalformedRefError, buildRef, parseRef } from './DataRef';

export {
    type AssetKindBrand,
    type AssetKind,
    type AssetKindId,
    type AssetKindRegistry,
    type AssetRef,
    type TextureAsset,
    type AudioClipAsset,
    type GLTFModelAsset,
    type SpriteSheetAsset,
    type ParticleConfigAsset,
    MalformedAssetRefError,
    buildAssetRef,
    parseAssetRef,
} from './AssetRef';

export { type AssetPriority, type AssetManifestEntry, type AssetManifest } from './AssetManifest';

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
