/**
 * simulation/persistence/CompressedSaveSerializer.ts
 *
 * gzip-compressed SaveSerializer: wraps JsonSaveSerializer with zlib
 * compression for space-efficient storage of large game states (§4.11).
 *
 * `zlib` is the sole Node.js import permitted in simulation/ — it is a
 * pure in-memory transform with no side effects (no I/O, no FS access).
 *
 * Architecture reference: §4.11
 * Task: F06 / T1 (issue #120)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free. zlib is a pure transform and is
 *          the declared exception to the no-Node.js-imports rule for this
 *          module (see issue #120 / T1 acceptance criteria).
 */

import { gzipSync, gunzipSync } from 'zlib';
import type { SaveFile } from './SaveFile.js';
import type { SaveSerializer } from './SaveSerializer.js';
import { JsonSaveSerializer } from './JsonSaveSerializer.js';

/**
 * Compresses the JSON representation of a `SaveFile` with gzip.
 * Returns a `Buffer` from `serialize`; expects a `Buffer` from `deserialize`.
 *
 * Use this serialiser for production saves of large-state games. Use
 * `JsonSaveSerializer` when human-readability or debuggability matters more
 * than file size.
 */
export class CompressedSaveSerializer implements SaveSerializer {
    private readonly inner = new JsonSaveSerializer();

    serialize(file: SaveFile): Buffer {
        return gzipSync(Buffer.from(this.inner.serialize(file), 'utf8'));
    }

    deserialize(raw: string | Buffer): SaveFile {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
        return this.inner.deserialize(gunzipSync(buf).toString('utf8'));
    }
}
