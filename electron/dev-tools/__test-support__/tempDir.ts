// electron/dev-tools/__test-support__/tempDir.ts
//
// A temp directory that removes itself when the test that asked for it ends.
//
// The bare `mkdtemp(join(tmpdir(), '<prefix>-'))` this replaces leaves one
// directory behind per CASE per run. That is
// invisible where it happens: the test passes and the suite is green.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * Create a temp directory registered for removal when the current test ends.
 *
 * Uses `onTestFinished` rather than an `afterEach` the caller has to remember
 * to write: registration happens at the call site, so a new call site cannot
 * acquire the directory without also acquiring its cleanup. It runs whether the
 * test passed or failed — a failing test is when a directory is most likely to
 * be left behind.
 *
 * `onTestFinished` throws at module scope, where it has no test to attach to;
 * a directory allocated there is removed by an `afterAll` instead.
 */
export async function createTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
    onTestFinished(async () => {
        await rm(dir, { recursive: true, force: true });
    });
    return dir;
}
