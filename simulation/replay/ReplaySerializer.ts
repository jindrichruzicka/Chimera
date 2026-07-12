/**
 * simulation/replay/ReplaySerializer.ts
 *
 * Pure JSON serialization and deserialization for ReplayFile.
 * No I/O, no Node.js platform APIs, no gzip — those live in
 * electron/main/replay/CompressedReplaySerializer.ts (same split as saves).
 *
 * Architecture reference: §4.28
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
import type { PerspectiveReplayFile } from './PerspectiveReplayFile.js';

// ─── Prototype-pollution defence ─────────────────────────────────────────────

/**
 * JSON.parse reviver that rejects the legacy __proto__ mutator key without
 * removing valid action payload fields such as `constructor` or `prototype`.
 *
 * Exported so the perspective serializer (electron/main) parses its gzipped
 * envelope with the identical guard — the deterministic and perspective read
 * paths share one prototype-pollution defence rather than diverging.
 */
export function safeReviver(key: string, value: unknown): unknown {
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

// ─── ReplaySerializer strategy ───────────────────────────────────────────────

/**
 * Strategy interface for turning a `ReplayFile` into storable bytes and back
 * (mirrors `SaveSerializer`, §4.11). The repository owns file paths; the
 * serializer owns only the byte representation.
 *
 * `serialize` may return a string (plain JSON) or a `Buffer` (e.g. gzip);
 * `deserialize` accepts either. Both are async so implementations may perform
 * non-blocking transforms — `CompressedReplaySerializer` (electron/main) uses
 * async gzip. Synchronous implementations wrap their result in a resolved
 * Promise.
 *
 * Implementations must be stateless and round-trip stable:
 * `deserialize(serialize(file))` is structurally equal to `file`.
 */
export interface ReplaySerializer {
    serialize(file: ReplayFile): Promise<string | Buffer>;
    deserialize(raw: string | Buffer): Promise<ReplayFile>;
}

/**
 * Plain-JSON `ReplaySerializer` — wraps the pure `serializeReplay` /
 * `deserializeReplay` functions and adapts them to the `ReplaySerializer`
 * contract. Human-readable; use `CompressedReplaySerializer` (electron/main)
 * when storage size matters.
 */
export class JsonReplaySerializer implements ReplaySerializer {
    serialize(file: ReplayFile): Promise<string> {
        return Promise.resolve(serializeReplay(file));
    }

    deserialize(raw: string | Buffer): Promise<ReplayFile> {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        // Convert a synchronous ReplayParseError into a rejected promise so
        // callers can rely on `.catch` / `await … rejects` uniformly.
        try {
            return Promise.resolve(deserializeReplay(text));
        } catch (cause) {
            return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
    }
}

// ─── PerspectiveReplaySerializer strategy ────────────────────────────────────

/**
 * Strategy interface for turning a `PerspectiveReplayFile` into storable bytes
 * and back — the privacy-preserving counterpart to {@link ReplaySerializer}.
 *
 * Unlike the deterministic side there is no plain-JSON implementation in
 * `simulation/`: the only production serializer (`CompressedPerspectiveReplaySerializer`,
 * electron/main) is keyframe + structural-delta + gzip, because a perspective
 * replay stores one projected `PlayerSnapshot` per tick and is therefore far
 * larger than an action log. The diff/gzip transform stays in `electron/main/`
 * (invariant #1); this interface is the pure abstraction both the repository and
 * that serializer depend on.
 *
 * Implementations must be stateless and round-trip stable at the snapshot level:
 * `deserialize(serialize(file))` is structurally equal to `file`.
 */
export interface PerspectiveReplaySerializer {
    serialize(file: PerspectiveReplayFile): Promise<string | Buffer>;
    deserialize(raw: string | Buffer): Promise<PerspectiveReplayFile>;
}
