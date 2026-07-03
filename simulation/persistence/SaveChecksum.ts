/**
 * simulation/persistence/SaveChecksum.ts
 *
 * SHA-256 checksum computation for save file bodies (issue #134).
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`) which is available in
 * Node.js 18+ and all modern browsers without any Node.js built-in imports.
 *
 * Architecture reference: §4.11
 * Task: F06 / integrity (issue #134)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 *        `globalThis.crypto` is a global, not a Node.js built-in import.
 */

import type { SaveFile } from './SaveFile.js';

// ─── SaveBody ─────────────────────────────────────────────────────────────────

/**
 * The portion of a `SaveFile` that participates in the integrity checksum.
 * The header is excluded because `header.checksum` itself is stored there.
 *
 * `session` is deliberately excluded too (F68, #820): the v5→v6 migration
 * backfills a manifest onto legacy files AFTER their checksum was stored, and
 * the repository verifies the checksum on the migrated file — including
 * `session` in the hash would fail every migrated v5 save. Unlike
 * `stagedReveals` (conditionally hashed because a populated map is gameplay
 * state needing integrity protection), the manifest is host-local
 * orchestration metadata and is never hashed at all, exactly like the header.
 */
export type SaveBody = Pick<
    SaveFile,
    'checkpoint' | 'deltaActions' | 'pendingCommitments' | 'stagedReveals'
>;

// ─── computeBodyChecksum ──────────────────────────────────────────────────────

/**
 * Compute a SHA-256 checksum of the canonical JSON representation of the
 * save body fields (`checkpoint`, `deltaActions`, `pendingCommitments`).
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
    // `stagedReveals` is included only when non-empty so that a pre-#26 save
    // (whose stored checksum was computed over the three original fields) still
    // verifies after the v4→v5 migration backfills `stagedReveals: {}`. An empty
    // map is semantically "no staging", so omitting it from the hash is correct;
    // a populated map IS integrity-protected.
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
