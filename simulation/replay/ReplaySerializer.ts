/**
 * simulation/replay/ReplaySerializer.ts
 *
 * Pure JSON serialization and deserialization for ReplayFile.
 * No I/O, no Node.js platform APIs, no gzip — those live in
 * electron/main/replay/CompressedReplaySerializer.ts (same split as saves).
 *
 * Architecture reference: §4.28
 * Task: F44 / T1 (issue #655)
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #43 — serializer functions are pure; no I/O, no Date.now, no Math.random
 *   #71 — replay files contain full EngineAction payloads; validated on load
 *
 * Security hardening (OWASP A08):
 *   - safeReviver rejects __proto__ instead of silently changing replay data.
 */

import { parseReplayFile, ReplayParseError } from './ReplayFile.js';
import type { ReplayFile } from './ReplayFile.js';

// ─── Prototype-pollution defence ─────────────────────────────────────────────

/**
 * JSON.parse reviver that rejects the legacy __proto__ mutator key without
 * removing valid action payload fields such as `constructor` or `prototype`.
 */
function safeReviver(key: string, value: unknown): unknown {
    if (key === '__proto__') {
        throw new ReplayParseError("Replay JSON contains disallowed '__proto__' key");
    }
    return value;
}

// ─── serializeReplay ─────────────────────────────────────────────────────────

/**
 * Serialises a `ReplayFile` to a JSON string.
 *
 * Pure function — no I/O, no side effects (invariant #43).
 * The caller is responsible for writing the result to disk; the serialiser
 * has no knowledge of file paths or storage locations.
 */
export function serializeReplay(file: ReplayFile): string {
    return JSON.stringify(file, null, 2);
}

// ─── deserializeReplay ───────────────────────────────────────────────────────

/**
 * Deserialises a JSON string back to a validated `ReplayFile`.
 *
 * Throws `ReplayParseError` if:
 *   - The input is not valid JSON.
 *   - The parsed value is not a plain object.
 *   - Any required field (`seed`, `actions`, `formatVersion`, …) is absent or
 *     has the wrong type.
 *
 * Pure function — no I/O, no side effects (invariant #43).
 */
export function deserializeReplay(json: string): ReplayFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json, safeReviver);
    } catch (cause) {
        if (cause instanceof ReplayParseError) {
            throw cause;
        }
        throw new ReplayParseError(
            `Replay JSON is not valid: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    }

    return parseReplayFile(parsed);
}
