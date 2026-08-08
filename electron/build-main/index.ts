/**
 * electron/build-main/index.ts
 *
 * Public barrel for `@chimera-engine/electron/build-main` — the Electron bundle
 * plan behind every consumer app's `build:app` (§3, §4.12, Invariant #27): the
 * packaging `define` that folds the debug gate, the esbuild alias/nodePaths
 * derivation, the output layout, and the bundle plan itself. Every symbol below
 * is DECLARED in `bundle-plan.ts` and nowhere else — `tools/packaged-build-flag.test.ts`
 * censuses that repo-wide. (Forwarding one is not declaring it: this barrel and
 * both app drivers re-export, which is the point of them.)
 *
 * Each consumer app drives it through a THIN, adopter-editable driver
 * (`apps/<game>/electron/build-main.ts`, and the scaffold template's copy),
 * which owns the paths, the module resolution and esbuild. The engine owns the
 * plan; the app owns where it points. Mirrors
 * `@chimera-engine/electron/packaged-bundle`, whose gate splits the same way.
 */

export {
    PACKAGED_BUILD_ENV,
    VERIFY_PACK_NODE_MODULES_ENV,
    appBundleOutfiles,
    buildAppBundles,
    computeEsbuildAlias,
    computeNodePaths,
    computePackagedDefine,
    createEsbuildBuild,
    esbuildBundleOptions,
    isPackagedBuild,
    planBundles,
    resolveDevDebugPreloadEntry,
    resolveInstalledDebugPreloadEntry,
    type AliasOptions,
    type AppBundlePlanOverrides,
    type BuildAppBundlesDeps,
    type BuildFn,
    type BundleLabel,
    type BundleOutfiles,
    type BundleSpec,
    type EsbuildBundleOptions,
    type PlanBundlesOptions,
    type PlannedBundleLabel,
} from './bundle-plan.js';
