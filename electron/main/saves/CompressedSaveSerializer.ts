/**
 * electron/main/saves/CompressedSaveSerializer.ts
 *
 * Async gzip-compressed SaveSerializer: wraps JsonSaveSerializer with
 * non-blocking zlib compression for space-efficient storage of large game
 * states (§4.11).
 *
 * Lives in electron/main/saves/ so that Node.js imports (node:zlib,
 * node:util) stay outside simulation/, satisfying invariant #2.
 *
 * Architecture reference: §4.11
 *
 * Invariants upheld:
 *   #2 — simulation/ has zero Node.js imports. This file is in electron/main/.
 */

import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import type { SaveSerializer } from '@chimera-engine/simulation/persistence/SaveSerializer.js';
import { JsonSaveSerializer } from '@chimera-engine/simulation/persistence/JsonSaveSerializer.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compresses the JSON representation of a `SaveFile` with async gzip.
 *
 * `serialize` returns a `Promise<Buffer>`; `deserialize` expects a `Buffer`.
 * Neither method blocks the event loop.
 *
 * Use this serialiser for production saves of large-state games. Use
 * `JsonSaveSerializer` when human-readability or debuggability matters more
 * than file size.
 */
export class CompressedSaveSerializer implements SaveSerializer {
    private readonly inner = new JsonSaveSerializer();

    async serialize(file: SaveFile): Promise<Buffer> {
        const json = await this.inner.serialize(file);
        return gzipAsync(Buffer.from(json, 'utf8'));
    }

    async deserialize(raw: string | Buffer): Promise<SaveFile> {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
        const decompressed = await gunzipAsync(buf);
        return this.inner.deserialize(decompressed.toString('utf8'));
    }
}
