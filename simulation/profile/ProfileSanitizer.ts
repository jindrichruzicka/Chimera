/**
 * simulation/profile/ProfileSanitizer.ts
 *
 * Host-side trust gate for inbound profile attestations.
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T02 (issue #339)
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, electron/, games/*, or DOM APIs
 *   #59 — Profile data is never stored in GameSnapshot, PlayerSnapshot, or SaveFile
 *   #61 — admit() is the mandatory gate between inbound JOIN/PROFILE_UPDATE and
 *          PlayerDirectory; a failed admission results in a REJECT — the raw
 *          attestation never reaches any other subsystem
 *
 * Design notes:
 *   - Pure. Idempotent. Never throws.
 *   - Uses a loose structural schema for initial parsing so that AVATAR_INVALID_MIME
 *     is reachable independently of SCHEMA_MISMATCH (defense in depth).
 *   - Buffer (Node.js built-in) used for base64 decode and magic-byte checks.
 *     No DOM APIs are used.
 */

import { z } from 'zod';

import type { PlayerProfile } from './ProfileSchema.js';

// ─── Public constants ─────────────────────────────────────────────────────────

export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_CUSTOM_AVATAR_BYTES = 64 * 1024; // 64 KB decoded
export const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

/**
 * localProfileId prefixes that are reserved by the engine.
 * Any attestation whose localProfileId starts with one of these is rejected
 * with NAMESPACE_COLLISION regardless of the existingIds set.
 */
export const RESERVED_ID_PREFIXES: readonly string[] = ['__chimera_', '__system_'];

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Discriminated set of reasons why admit() may reject an attestation.
 *
 * | Reason                  | Trigger                                                          |
 * | ----------------------- | ---------------------------------------------------------------- |
 * | DISPLAY_NAME_EMPTY      | displayName.trim().length === 0                                  |
 * | DISPLAY_NAME_TOO_LONG   | displayName.length > MAX_DISPLAY_NAME_LENGTH                     |
 * | AVATAR_INVALID_MIME     | Custom mimeType not in ALLOWED_AVATAR_MIME_TYPES                 |
 * | AVATAR_TOO_LARGE        | Decoded bytes > MAX_CUSTOM_AVATAR_BYTES                          |
 * | AVATAR_DECODE_FAILED    | base64 invalid or bytes fail magic-bytes check                   |
 * | SCHEMA_MISMATCH         | Missing required field, wrong type                               |
 * | NAMESPACE_COLLISION     | localProfileId uses reserved prefix or duplicates lobby entry    |
 */
export type AdmissionRejection =
    | 'DISPLAY_NAME_EMPTY'
    | 'DISPLAY_NAME_TOO_LONG'
    | 'AVATAR_INVALID_MIME'
    | 'AVATAR_TOO_LARGE'
    | 'AVATAR_DECODE_FAILED'
    | 'SCHEMA_MISMATCH'
    | 'NAMESPACE_COLLISION';

export type AdmissionResult =
    | { readonly ok: true; readonly profile: PlayerProfile }
    | { readonly ok: false; readonly reason: AdmissionRejection };

// ─── Internal schema ──────────────────────────────────────────────────────────

/**
 * Loose structural schema used for the first parsing pass inside admit().
 *
 * Intentionally accepts any string for custom avatar mimeType so that
 * AVATAR_INVALID_MIME can be raised as a distinct rejection type rather than
 * being collapsed into SCHEMA_MISMATCH.
 */
const LooseAvatarSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('builtin'), ref: z.string() }).strict(),
    z
        .object({
            kind: z.literal('custom'),
            mimeType: z.string(),
            base64: z.string(),
        })
        .strict(),
]);

const LooseProfileSchema = z
    .object({
        localProfileId: z.string(),
        displayName: z.string(),
        avatar: LooseAvatarSchema,
        locale: z.string(),
    })
    .strict();

type LooseProfile = z.infer<typeof LooseProfileSchema>;

// ─── Magic-byte helpers ───────────────────────────────────────────────────────

/** PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** JPEG magic bytes (SOI marker): FF D8 FF */
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

/** Valid base64 characters — used to detect syntactically invalid base64. */
const VALID_BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Returns the reason code if the custom avatar fails avatar-specific checks,
 * or `null` if all checks pass.
 *
 * Checks in order: AVATAR_INVALID_MIME → AVATAR_TOO_LARGE → AVATAR_DECODE_FAILED.
 */
function checkCustomAvatar(
    mimeType: string,
    base64: string,
): 'AVATAR_INVALID_MIME' | 'AVATAR_TOO_LARGE' | 'AVATAR_DECODE_FAILED' | null {
    // 1. MIME whitelist
    if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(mimeType)) {
        return 'AVATAR_INVALID_MIME';
    }

    // 2. Validate base64 syntax before attempting decode
    if (!VALID_BASE64_RE.test(base64)) {
        return 'AVATAR_DECODE_FAILED';
    }

    // Decode base64 → bytes
    let bytes: Buffer;
    try {
        bytes = Buffer.from(base64, 'base64');
    } catch {
        return 'AVATAR_DECODE_FAILED';
    }

    // 3. Size cap (decoded byte count)
    if (bytes.length > MAX_CUSTOM_AVATAR_BYTES) {
        return 'AVATAR_TOO_LARGE';
    }

    // 4. Magic-bytes check
    const validMimeType = mimeType as (typeof ALLOWED_AVATAR_MIME_TYPES)[number];
    if (!hasMagicBytes(bytes, validMimeType)) {
        return 'AVATAR_DECODE_FAILED';
    }

    return null;
}

function hasMagicBytes(
    bytes: Buffer,
    mimeType: (typeof ALLOWED_AVATAR_MIME_TYPES)[number],
): boolean {
    if (mimeType === 'image/png') {
        if (bytes.length < PNG_MAGIC.length) return false;
        return PNG_MAGIC.every((b, i) => bytes[i] === b);
    }
    // image/jpeg
    if (bytes.length < JPEG_MAGIC.length) return false;
    return JPEG_MAGIC.every((b, i) => bytes[i] === b);
}

// ─── admit() ─────────────────────────────────────────────────────────────────

/**
 * Validates an inbound profile attestation and, if admitted, returns a typed
 * `PlayerProfile` ready for insertion into the `PlayerDirectory`.
 *
 * Pure. Idempotent. Never throws.
 *
 * @param attestation           - The raw unknown payload from a JOIN or PROFILE_UPDATE
 *                                message. May be any value.
 * @param existingIds           - The set of `localProfileId` values already registered
 *                                in the current lobby. Used to detect duplicates.
 *                                Defaults to an empty set.
 * @param gameSchemaValidator   - Optional game-specific validator. Receives the base-
 *                                validated `PlayerProfile` and returns `false` to reject
 *                                it with `SCHEMA_MISMATCH`. Used by game-specific profile
 *                                extensions (e.g. TacticsProfile) to enforce extra fields
 *                                beyond the `EngineProfile` base.
 */
export function admit(
    attestation: unknown,
    existingIds: ReadonlySet<string> = new Set(),
    gameSchemaValidator?: (profile: PlayerProfile) => boolean,
): AdmissionResult {
    // Step 1 — Structural validation (loose schema to allow AVATAR_INVALID_MIME)
    const parsed = LooseProfileSchema.safeParse(attestation);
    if (!parsed.success) {
        return { ok: false, reason: 'SCHEMA_MISMATCH' };
    }

    const raw: LooseProfile = parsed.data;

    // Step 2 — Custom avatar checks (MIME, size, magic bytes)
    if (raw.avatar.kind === 'custom') {
        const avatarRejection = checkCustomAvatar(raw.avatar.mimeType, raw.avatar.base64);
        if (avatarRejection !== null) {
            return { ok: false, reason: avatarRejection };
        }
    }

    // Step 3 — Display name: empty check before length check
    if (raw.displayName.trim().length === 0) {
        return { ok: false, reason: 'DISPLAY_NAME_EMPTY' };
    }

    if (raw.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        return { ok: false, reason: 'DISPLAY_NAME_TOO_LONG' };
    }

    // Step 4 — Namespace collision (reserved prefixes + existing lobby entries)
    const hasReservedPrefix = RESERVED_ID_PREFIXES.some((prefix) =>
        raw.localProfileId.startsWith(prefix),
    );
    if (hasReservedPrefix || existingIds.has(raw.localProfileId)) {
        return { ok: false, reason: 'NAMESPACE_COLLISION' };
    }

    // Step 5 — Game-schema validator (optional; enables game-specific profile extensions)
    // Cast is safe: all base EngineProfile fields have been validated above.
    const profile = raw as PlayerProfile;
    if (gameSchemaValidator !== undefined && !gameSchemaValidator(profile)) {
        return { ok: false, reason: 'SCHEMA_MISMATCH' };
    }

    return { ok: true, profile };
}
