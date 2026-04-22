/**
 * simulation/persistence/SaveSerializer.ts
 *
 * Strategy interface for serialising / deserialising a SaveFile (§4.11).
 *
 * Games choose which serialiser to use; the engine core is not coupled
 * to any specific format. Two implementations are provided:
 *   - JsonSaveSerializer  — human-readable JSON (debuggable)
 *   - CompressedSaveSerializer — gzip-compressed JSON (space-efficient)
 *
 * Architecture reference: §4.11
 * Task: F06 / T1 (issue #120)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 */

import type { SaveFile } from './SaveFile.js';

/**
 * Strategy interface for save file serialisation.
 *
 * `serialize` converts a `SaveFile` to a storable form (string or binary
 * Buffer). `deserialize` reverses the transformation.
 *
 * Implementations must be stateless: the same `SaveFile` always produces
 * the same bytes, and `deserialize(serialize(file))` is structurally equal
 * to `file`.
 */
export interface SaveSerializer {
    serialize(file: SaveFile): string | Buffer;
    deserialize(raw: string | Buffer): SaveFile;
}
