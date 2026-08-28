/**
 * simulation/persistence/SaveChecksum.ts
 *
 * SHA-256 checksum computation for save file bodies.
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`) which is available in
 * Node.js 18+ and all modern browsers without any Node.js built-in imports.
 *
 * Architecture reference: §4.11
 *
 * Invariants upheld:
 *   #1 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 *        `globalThis.crypto` is a global, not a Node.js built-in import.
 */

import type { SaveFile } from './SaveFile.js';

// ─── SaveBody ─────────────────────────────────────────────────────────────────

/**
 * The portion of a `SaveFile` that participates in the integrity checksum.
 * The header is excluded because `header.checksum` itself is stored there.
 *
 * `session` is deliberately excluded too: it is host-local orchestration
 * metadata, never gameplay state, so it is no more integrity-protected than
 * the header. The v5→v6 migration backfills a manifest onto legacy files
 * AFTER their checksum was stored; leaving it out of the hash keeps the digest
 * of a v5 save and its migrated v6 form identical. Unlike `stagedReveals`
 * (conditionally hashed because a populated map IS gameplay state needing
 * integrity protection), the manifest is never hashed at all.
 */
export type SaveBody = Pick<
    SaveFile,
    'checkpoint' | 'deltaActions' | 'pendingCommitments' | 'stagedReveals'
>;

// ─── computeBodyChecksum ──────────────────────────────────────────────────────

/**
 * Compute a SHA-256 checksum of the canonical JSON representation of the
 * {@link SaveBody} fields.
 *
 * Returns a 64-character lowercase hex string.
 *
 * Uses `globalThis.crypto.subtle.digest` (Web Crypto API) — available in
 * Node.js 18+ and all modern browsers without importing Node.js built-ins.
 *
 * @param body - The save body fields to hash.
 * @returns A 64-character hex SHA-256 digest.
 */
export async function computeBodyChecksum(body: SaveBody): Promise<string> {
    // `stagedReveals` is included only when non-empty so that a v4 save — whose
    // stored checksum was computed over the three original fields — hashes to
    // the same digest whether it is read before or after the v4→v5 backfill of
    // `stagedReveals: {}`. An empty map is semantically "no staging", so omitting
    // it from the hash is correct; a populated map IS integrity-protected.
    const stagedReveals = body.stagedReveals ?? {};
    const canonical = JSON.stringify({
        checkpoint: body.checkpoint,
        deltaActions: body.deltaActions,
        pendingCommitments: body.pendingCommitments,
        ...(Object.keys(stagedReveals).length > 0 ? { stagedReveals } : {}),
    });

    const encoded = new TextEncoder().encode(canonical);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
