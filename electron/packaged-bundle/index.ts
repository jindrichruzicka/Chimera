/**
 * electron/packaged-bundle/index.ts
 *
 * Public barrel for `@chimera-engine/electron/packaged-bundle` — the single
 * home of the Runtime Debug Layer's packaged-bundle guard (§4.12, Invariant
 * #27): the marker set whose absence proves the layer left a packaged bundle,
 * and the self-validating verification every consumer app's
 * `verify:packaged-bundle` gate drives through a thin, app-owned driver.
 */

export {
    ALL_DEBUG_GRAPH_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_GRAPH_MARKERS,
    DEBUG_PUSH_CHANNEL_LITERAL,
    DEBUG_REQUEST_CHANNEL_RE,
    FOLDED_GATE_LITERAL,
} from './debug-bundle-markers.js';

export {
    checkBundleText,
    devRejectionGaps,
    electronBuilderControlGaps,
    electronBuilderDistFailures,
    foldedGateFailure,
    verifyPackagedBundle,
    type ElectronBuilderCheckOptions,
    type Failure,
    type PackagedBundleOutfiles,
    type VerifyPackagedBundleIo,
    type VerifyPackagedBundleOptions,
} from './verify-packaged-bundle.js';
