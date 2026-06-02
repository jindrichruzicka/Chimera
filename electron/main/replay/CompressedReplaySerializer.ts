/**
 * electron/main/replay/CompressedReplaySerializer.ts
 *
 * Async gzip-compressed replay serializer: wraps the pure
 * simulation-layer JSON functions with non-blocking zlib compression.
 *
 * Lives in electron/main/replay/ so that Node.js imports (node:zlib,
 * node:util) stay outside simulation/, satisfying invariant #1.
 *
 * Architecture reference: §4.28
 * Task: F44 / T1 (issue #655)
 *
 * Invariants upheld:
 *   #1 — simulation/ has zero Node.js imports. This file is in electron/main/.
 *   #43 — the pure serializeReplay/deserializeReplay in simulation/ are untouched.
 */

import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { serializeReplay, deserializeReplay } from '@chimera/simulation/replay/index.js';
import type { ReplayFile } from '@chimera/simulation/replay/index.js';
import { ReplayParseError } from '@chimera/simulation/replay/index.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compresses the JSON representation of a `ReplayFile` with async gzip.
 *
 * `serializeReplayCompressed` returns a `Promise<Buffer>`.
 * `deserializeReplayCompressed` expects a `Buffer`.
 * Neither method blocks the event loop.
 *
 * Use this for production replay exports. Use the plain simulation-layer
 * `serializeReplay`/`deserializeReplay` when human-readability matters.
 */
export async function serializeReplayCompressed(file: ReplayFile): Promise<Buffer> {
    const json = serializeReplay(file);
    return gzipAsync(Buffer.from(json, 'utf8'));
}

export async function deserializeReplayCompressed(buf: Buffer): Promise<ReplayFile> {
    let decompressed: Buffer;
    try {
        decompressed = await gunzipAsync(buf);
    } catch (cause) {
        throw new ReplayParseError(
            `Compressed replay data could not be decompressed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    }
    return deserializeReplay(decompressed.toString('utf8'));
}
