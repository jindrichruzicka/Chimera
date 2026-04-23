/**
 * simulation/persistence/JsonSaveSerializer.ts
 *
 * Default SaveSerializer implementation: pretty-printed JSON.
 * Human-readable and easy to inspect / debug (§4.11).
 *
 * Architecture reference: §4.11
 * Task: F06 / T1 (issue #120)
 *
 * Security hardening (issue #133 — OWASP A08):
 *   - Maximum raw size enforced before JSON.parse (prevents DoS via huge inputs).
 *   - safeReviver drops __proto__, constructor, and prototype keys to prevent
 *     prototype pollution.
 *   - Zod schema validation ensures the parsed object matches the SaveFile shape
 *     before the result is returned to callers.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 *   #44 — SaveFileHeaderSchema enforces integer constraints on schemaVersion,
 *          savedAt, and turnNumber; CheckpointSchema enforces tick and seed.
 */

import { z } from 'zod';
import type { SaveFile } from './SaveFile.js';
import type { SaveSerializer } from './SaveSerializer.js';
import { SaveParseError } from './SaveMigrator.js';

// ─── Size limit ───────────────────────────────────────────────────────────────

/**
 * Maximum number of characters accepted by `deserialize` before calling
 * `JSON.parse`. A save file larger than this is rejected with `SaveParseError`.
 * 64 M characters corresponds to roughly 64–256 MB of UTF-8 data.
 */
export const MAX_SAVE_SIZE_CHARS = 64 * 1024 * 1024;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const SaveFileHeaderSchema = z.object({
    schemaVersion: z.number().int(),
    engineVersion: z.string(),
    gameId: z.string(),
    gameVersion: z.string(),
    slotId: z.string(),
    savedAt: z.number().int(),
    turnNumber: z.number().int(),
    playerNames: z.array(z.string()),
    thumbnailDataUrl: z.string().optional(),
    checksum: z.string().optional(),
});

/**
 * Validates the minimum required structure of a `SaveFile` object parsed from
 * untrusted JSON. The checkpoint schema enforces integer-only arithmetic fields
 * (invariant #44). Extra fields on any nested object are permitted.
 */
const SaveFileSchema = z.object({
    header: SaveFileHeaderSchema,
    checkpoint: z.object({
        tick: z.number().int(),
        seed: z.number().int(),
        phase: z.string(),
        players: z.record(z.string(), z.unknown()),
        entities: z.record(z.string(), z.unknown()),
        events: z.array(z.unknown()),
    }),
    deltaActions: z.array(z.unknown()),
    pendingCommitments: z.record(z.string(), z.unknown()),
});

// ─── Prototype-pollution defence ─────────────────────────────────────────────

/**
 * JSON.parse reviver that silently drops keys whose names could be exploited
 * for prototype pollution (`__proto__`, `constructor`, `prototype`).
 *
 * The `value` parameter carries `any` because the JSON.parse reviver signature
 * in TypeScript's lib.d.ts requires it; the function does not inspect the value
 * beyond an identity return.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeReviver(key: string, value: any): unknown {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
    }
    return value;
}

// ─── JsonSaveSerializer ───────────────────────────────────────────────────────

/**
 * Serialises `SaveFile` to pretty-printed JSON and back.
 *
 * Used as the default (human-readable) format and as the inner layer for
 * `CompressedSaveSerializer`. Both callers benefit from the indented output
 * making compressed-file payloads highly compressible.
 *
 * `deserialize` enforces a size limit, a safe JSON reviver, and Zod schema
 * validation before returning a result. It throws `SaveParseError` on any
 * violation.
 */
export class JsonSaveSerializer implements SaveSerializer {
    serialize(file: SaveFile): Promise<string> {
        return Promise.resolve(JSON.stringify(file, null, 2));
    }

    deserialize(raw: string | Buffer): Promise<SaveFile> {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');

        if (text.length > MAX_SAVE_SIZE_CHARS) {
            return Promise.reject(
                new SaveParseError(
                    `Save file exceeds maximum allowed size of ${MAX_SAVE_SIZE_CHARS.toString()} characters`,
                ),
            );
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(text, safeReviver);
        } catch (cause) {
            return Promise.reject(
                new SaveParseError(
                    `Save file contains invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
            );
        }

        const result = SaveFileSchema.safeParse(parsed);
        if (!result.success) {
            return Promise.reject(
                new SaveParseError(`Save file failed schema validation: ${result.error.message}`),
            );
        }

        // Safe: Zod has validated the required structural shape. Branded types
        // (PlayerId, EntityId, GamePhase) are string aliases — JSON always
        // produces plain strings which are assignable to branded aliases at
        // runtime. The cast narrows from `unknown` (JSON.parse output) to the
        // fully-typed SaveFile interface after schema validation has passed.
        return Promise.resolve(parsed as SaveFile);
    }
}
