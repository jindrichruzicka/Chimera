/**
 * apps/tactics/electron/debug-bundle-markers.ts
 *
 * The strings whose ABSENCE means the Runtime Debug Layer (§4.12, Invariant #27)
 * left a packaged Electron bundle.
 *
 * Extracted so the in-memory bundle assertions
 * (`__tests__/packaged-bundle-content.test.ts`) and the real-artifact gate
 * (`tools/verify-packaged-bundle.ts`) share ONE definition. Two copies of a
 * marker set drift silently and in one direction only — the weaker copy stops
 * naming a module and its checks keep passing.
 */

/**
 * Marker strings per GATED MODULE — every module the debug gate dynamically
 * imports needs at least one, or hoisting that module out of the gate ships it
 * with the assertions still green. Listing markers for only some of the gated
 * modules is a silent hole, not a partial guard. An anti-rot test fails if a
 * gated import ever appears without markers here.
 *
 * Markers must be unique to their module and survive in a DEV bundle. Three
 * names are deliberately absent:
 *
 * - `startDebugBridge` / `buildNetworkDiagnostics` — esbuild folds the gate and
 *   drops the modules, but with `minify: false` it leaves the dead
 *   `if (false) { … }` statements in place, rewritten to `await null`. Those
 *   residual lines name the calls while reaching no module at all.
 * - `diffSnapshots` — ambiguous. A debug export (`simulation/debug/SnapshotDiff.ts`)
 *   AND an unrelated replay function (`electron/main/replay/CompressedReplaySerializer.ts`)
 *   that ships in every build, so its presence proves nothing.
 *
 * Each marker below was verified by building both ways: present in dev, absent
 * packaged. Two are deliberately narrower than the obvious choice:
 *
 * - `createInspectorWindow` rather than a `chimera:debug*` channel string. The
 *   channels are declared in `simulation/foundation/constants.ts`, so they track
 *   that module's tree-shaking rather than `debug-bridge.js` — a marker filed
 *   under a module it does not actually track is not load-bearing for it.
 * - `isHosting: hostPort !== null` rather than bare `isHosting` / `localAddresses`,
 *   which also name fields of the `NetworkDiagnostics` interface in
 *   `simulation/debug/DebugProtocol.ts`. The marker pins a full expression from
 *   the function body instead.
 */
export const DEBUG_GRAPH_MARKERS: Readonly<Record<string, readonly string[]>> = {
    './debug-bridge.js': ['SnapshotRingBuffer', 'SnapshotInspector', 'createInspectorWindow'],
    './network-diagnostics.js': ['isHosting: hostPort !== null'],
};

/** Every per-module marker, flattened. */
export const ALL_DEBUG_GRAPH_MARKERS: readonly string[] = Object.values(DEBUG_GRAPH_MARKERS).flat();

/**
 * ARTIFACT-keyed markers, kept separate from the per-module set above because
 * they are keyed on what a live debug surface must REFERENCE rather than on a
 * module filename. The per-module markers only reach modules listed by name, so
 * a debug module named outside the `./debug*` convention — statically imported,
 * registering its handler at module load — slips past every name-keyed check. A
 * handler on the debug channel has to drag the channel string into whatever
 * bundle it lands in, whatever its file is called.
 *
 * They also give the SHIPPING preload its only content coverage: all four
 * per-module markers are main-graph symbols, so without these the preload would
 * be checked for a missing bundle LABEL and nothing else.
 *
 * The negative lookahead is load-bearing, not stylistic: `chimera:debug` is a
 * prefix of the data-free `chimera:debug:toggle-inspector` and
 * `chimera:debug:toggle-i18n-token-mode` sends that Invariant #28 explicitly
 * permits, and both are legitimately present in a packaged preload. Matching the
 * request channel alone requires rejecting a following `:` or word character.
 *
 * A bare-string assertion on `ipcMain.handle(...)` would be vacuous instead:
 * esbuild renames the binding (`ipcMain2.handle`). String CONTENTS are never
 * mangled, which is why the channel values work where identifiers do not.
 */
export const DEBUG_REQUEST_CHANNEL_RE = /chimera:debug(?![:\w-])/;
export const DEBUG_PUSH_CHANNEL_LITERAL = 'chimera:debug:push';
export const DEBUG_BRIDGE_GLOBAL = '__chimeraDebug';

/**
 * The folded gate's signature in a packaged bundle. Its PRESENCE is asserted
 * alongside the markers' absence: an empty or truncated bundle satisfies every
 * absence check, so the positive is what makes those checks non-vacuous.
 */
export const FOLDED_GATE_LITERAL = 'IS_DEBUG_MODE = false';
