/**
 * electron/main/__tests__/loadGameContent.integration.test.ts
 *
 * Integration tests for the production startup content load, driven against a
 * synthetic game-assets root on a real temp directory (§12.3 — a multi-module
 * test that exercises the filesystem belongs here, not co-located).
 *
 * This is the guard that outlives the loader's `validateRefs` default: it fails
 * whether the regression is the default reverting to opt-in or this call site
 * opting out, and it pins the error attribution the fatal startup path needs.
 *
 * Architecture: §4.8 — Content Database.
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/content/loadGameContent.ts` and `simulation/content/`.
 *
 * Invariants verified:
 *   #14 — schemas AND refs validated before the tick loop; a failed load is fatal
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { UnknownDataRefError } from '@chimera-engine/simulation/content/index.js';
import { loadAllGameContent } from '../content/loadGameContent.js';

describe('loadAllGameContent — ref integrity (Invariant #14)', () => {
    let tmpRoot: string | undefined;

    afterEach(async () => {
        if (tmpRoot !== undefined) {
            await fs.rm(tmpRoot, { recursive: true, force: true });
            tmpRoot = undefined;
        }
    });

    /** Write `<root>/<gameId>/data/<collection>/<id>.json` for each item. */
    async function makeAssetsRoot(
        gameId: string,
        collections: Record<string, Record<string, unknown>[]>,
    ): Promise<string> {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-game-content-'));
        for (const [collectionType, items] of Object.entries(collections)) {
            const dir = path.join(tmpRoot, gameId, 'data', collectionType);
            await fs.mkdir(dir, { recursive: true });
            for (const item of items) {
                await fs.writeFile(
                    path.join(dir, `${String(item['id'])}.json`),
                    JSON.stringify(item),
                );
            }
        }
        return tmpRoot;
    }

    it('rejects a game whose content carries a dangling DataRef', async () => {
        const root = await makeAssetsRoot('reftest', {
            'player-colors': [{ id: 'blue', name: 'Blue' }],
            units: [{ id: 'warrior', color: 'player-colors:teal' }],
        });

        await expect(loadAllGameContent(root, { reftest: {} })).rejects.toThrow(
            /player-colors:teal/,
        );
    });

    // This is a fatal-startup path, and the host loads every registered game in
    // one loop: a bare ref string leaves the developer guessing which game's
    // data tree it came from.
    it('names the failing game and its data directory, preserving the cause', async () => {
        const root = await makeAssetsRoot('reftest', {
            'player-colors': [{ id: 'blue', name: 'Blue' }],
            units: [{ id: 'warrior', color: 'player-colors:teal' }],
        });

        const err = await loadAllGameContent(root, { reftest: {} }).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/reftest/);
        expect((err as Error).message).toContain(path.join(root, 'reftest', 'data'));
        expect((err as Error).cause).toBeInstanceOf(UnknownDataRefError);
    });

    it('loads the same content once the ref resolves', async () => {
        const root = await makeAssetsRoot('reftest', {
            'player-colors': [{ id: 'blue', name: 'Blue' }],
            units: [{ id: 'warrior', color: 'player-colors:blue' }],
        });

        const dbs = await loadAllGameContent(root, { reftest: {} });
        expect(dbs.get('reftest')?.has('units', 'warrior')).toBe(true);
    });
});
