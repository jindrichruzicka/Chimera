import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    ACTION_E2E_BUILD_DIR_NAME,
    resolveActionE2eAssetCopy,
    resolveActionE2eBuildRoot,
    resolveActionE2eOutfiles,
    resolveActionRendererEntry,
} from './global-setup';

const REPO_ROOT = '/repo';

/**
 * The action suite's e2e LAYOUT — the four paths global-setup writes to and the
 * launch fixture reads back.
 *
 * They are exported and asserted rather than spelled twice because the two
 * sides drifting is silent: the fixture would find no bundle, call the setup
 * again, and still launch against whatever it was pointed at. Every case below
 * is a mistake a copy of the tactics suite actually makes.
 */
describe('action e2e build layout', () => {
    it('builds into a root of its OWN, not the tactics suite’s .e2e-build', () => {
        // Both global-setups delete their whole build root on every run. Sharing
        // one would mean whichever suite started last deleted the other's
        // bundles out from under a running app.
        expect(ACTION_E2E_BUILD_DIR_NAME).not.toBe('.e2e-build');
        expect(resolveActionE2eBuildRoot(REPO_ROOT)).toBe(
            path.join(REPO_ROOT, ACTION_E2E_BUILD_DIR_NAME),
        );
    });

    it('nests main one level deeper than production so the sibling preload still resolves', () => {
        // The host resolves its preload as `<mainDir>/../preload/api.js`, so the
        // main bundle must sit at electron/main/index.js — not at electron/main.js,
        // which is where the production layout puts it.
        const outfiles = resolveActionE2eOutfiles(path.join(REPO_ROOT, '.probe'));

        expect(outfiles.main).toBe(path.join(REPO_ROOT, '.probe/electron/main/index.js'));
        expect(outfiles.preload).toBe(path.join(REPO_ROOT, '.probe/electron/preload/api.js'));
        expect(path.relative(path.dirname(outfiles.main), outfiles.preload)).toBe(
            path.join('..', 'preload', 'api.js'),
        );
    });

    it('points the renderer entry at the ACTION app’s own Next export', () => {
        // apps/action/renderer → apps/action/renderer/out. A suite copied from
        // tactics launches green against the tactics GUI and proves nothing
        // about this app.
        expect(resolveActionRendererEntry(REPO_ROOT)).toBe(
            path.join(REPO_ROOT, 'apps/action/renderer/out/index.html'),
        );
    });

    it('mirrors the host package’s icons where the default-icon fallback looks', () => {
        // The action manifest declares no `icon`, so `resolveAppIcon` falls back
        // to `<mainDir>/../../assets/icons/chimera.png` — i.e. `<buildRoot>/assets`.
        // Production ships those via electron-builder; the e2e layout has no
        // packager, so without this copy `app.dock.setIcon` throws mid-window
        // creation and every spec times out at `firstWindow`.
        const buildRoot = path.join(REPO_ROOT, '.probe');
        const copy = resolveActionE2eAssetCopy(REPO_ROOT, buildRoot);

        expect(copy.from).toBe(path.join(REPO_ROOT, 'electron/assets'));
        expect(copy.to).toBe(path.join(buildRoot, 'assets'));
        // The fallback is resolved from the MAIN bundle's directory, so the two
        // paths have to agree about how deep that is.
        const mainDir = path.dirname(resolveActionE2eOutfiles(buildRoot).main);
        expect(path.resolve(mainDir, '..', '..', 'assets')).toBe(copy.to);
    });
});
