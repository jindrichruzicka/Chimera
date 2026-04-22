/**
 * simulation/persistence/JsonSaveSerializer.ts
 *
 * Default SaveSerializer implementation: pretty-printed JSON.
 * Human-readable and easy to inspect / debug (§4.11).
 *
 * Architecture reference: §4.11
 * Task: F06 / T1 (issue #120)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 */

import type { SaveFile } from './SaveFile.js';
import type { SaveSerializer } from './SaveSerializer.js';

/**
 * Serialises `SaveFile` to pretty-printed JSON and back.
 *
 * Used as the default (human-readable) format and as the inner layer for
 * `CompressedSaveSerializer`. Both callers benefit from the indented output
 * making compressed-file payloads highly compressible.
 */
export class JsonSaveSerializer implements SaveSerializer {
    serialize(file: SaveFile): string {
        return JSON.stringify(file, null, 2);
    }

    deserialize(raw: string | Buffer): SaveFile {
        // JSON.parse returns `any`; the cast is safe because we only call
        // deserialize on data previously written by serialize (or a
        // compatible migrated file). Runtime schema validation belongs to
        // SaveMigrator, not the serialiser.
        return JSON.parse(raw.toString()) as SaveFile;
    }
}
