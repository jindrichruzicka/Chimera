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
 */
export type SaveBody = Pick<SaveFile, 'checkpoint' | 'deltaActions' | 'pendingCommitments'>;

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
    const canonical = JSON.stringify({
        checkpoint: body.checkpoint,
        deltaActions: body.deltaActions,
        pendingCommitments: body.pendingCommitments,
    });

    const encoded = new TextEncoder().encode(canonical);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
