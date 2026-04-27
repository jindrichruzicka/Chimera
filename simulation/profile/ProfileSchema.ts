/**
 * simulation/profile/ProfileSchema.ts
 *
 * Core profile types and repository interface for the Chimera engine.
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T01 (issue #338)
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, electron/, games/*, or DOM APIs
 *   #59 — Profile data is never stored in GameSnapshot, PlayerSnapshot, or SaveFile.
 *         This module establishes the type boundary that enforces that rule.
 */

import { z } from 'zod';

import type { AssetRef, TextureAsset } from '../content/AssetRef.js';

// ─── LocalProfileId — branded identifier ──────────────────────────────────────

/**
 * Stable, client-local identifier for a player profile.
 *
 * Branded to prevent accidental mixing with other string-shaped values
 * (e.g. PlayerId, session tokens).  Used as the primary key in
 * ProfileRepository and for pass-and-play seat switching.
 */
export type LocalProfileId = string & { readonly __brand: 'LocalProfileId' };

/**
 * Constructs a branded {@link LocalProfileId} from a raw string.
 *
 * This is the single authorised cast site for the LocalProfileId brand —
 * using `raw as LocalProfileId` directly elsewhere is a lint/review violation.
 */
export const localProfileId = (raw: string): LocalProfileId => raw as LocalProfileId;

// ─── AvatarSource — discriminated union ───────────────────────────────────────

/**
 * Discriminated union covering the two avatar representation strategies:
 *
 * - `builtin`  — references an engine/game asset via an AssetRef string.
 *                Zero transport cost; the ref is already known to the renderer.
 * - `custom`   — inline base64-encoded image (max 64 KB decoded).
 *                Validated by ProfileSanitizer before entering PlayerDirectory.
 */
export type AvatarSource =
    | { readonly kind: 'builtin'; readonly ref: AssetRef<TextureAsset> }
    | {
          readonly kind: 'custom';
          readonly mimeType: 'image/png' | 'image/jpeg';
          readonly base64: string;
      };

// ─── EngineProfile ────────────────────────────────────────────────────────────

/**
 * Base profile type carried by every player in the engine.
 *
 * All fields are `readonly` — mutations produce a new object rather than
 * mutating in place.  Cosmetic data only; never enters GameSnapshot,
 * PlayerSnapshot, or SaveFile (Invariant #59).
 */
export interface EngineProfile {
    readonly localProfileId: LocalProfileId;
    readonly displayName: string; // Length-capped by ProfileSanitizer (max 32 chars)
    readonly avatar: AvatarSource;
    readonly locale: string; // BCP 47 tag, e.g. 'en-US'
}

// ─── GameProfileSchema / PlayerProfile ────────────────────────────────────────

/**
 * Phantom constraint for game-specific profile extensions.
 *
 * Games that need extra profile fields (e.g. a faction preference) declare
 * `interface TacticsProfile extends EngineProfile { ... }` and use
 * `GameProfileSchema<TacticsProfile>` as the schema parameter for
 * ProfileSanitizer.admit() and ProfileRepository.
 */
export type GameProfileSchema<TProfile extends EngineProfile> = TProfile;

/**
 * Convenience alias for the unextended engine profile — the profile type
 * used when no game-specific fields are required.
 */
export type PlayerProfile = GameProfileSchema<EngineProfile>;

// ─── ProfileRepository — interface ────────────────────────────────────────────

/**
 * Persistence contract for the local machine's player profiles.
 *
 * Invariant #60: implementations persist ONLY local profiles.
 * Remote clients' profiles live exclusively in the in-memory PlayerDirectory.
 *
 * Method semantics:
 *   - `load`            — Returns null when the profile does not exist.
 *   - `save`            — Atomic write (tmp-file + rename).
 *   - `listLocalSlots`  — Lightweight listing for pass-and-play seat switching.
 *   - `delete`          — Removes a profile slot permanently.
 */
export interface ProfileRepository {
    load(localProfileId: LocalProfileId): Promise<PlayerProfile | null>;
    save(profile: PlayerProfile): Promise<void>;
    listLocalSlots(): Promise<
        readonly { readonly localProfileId: LocalProfileId; readonly displayName: string }[]
    >;
    delete(localProfileId: LocalProfileId): Promise<void>;
}

// ─── EngineProfileSchema — Zod runtime validator ──────────────────────────────

/**
 * Zod schema for runtime validation of inbound profile attestations.
 *
 * Used by ProfileSanitizer.admit() and any IPC handler that receives a raw
 * `unknown` payload claiming to be an EngineProfile.  Structural validation
 * only — business-rule checks (display-name length caps, avatar byte limits,
 * image magic bytes) are enforced separately in ProfileSanitizer.
 */
export const EngineProfileSchema = z.object({
    localProfileId: z.string(),
    displayName: z.string(),
    avatar: z.discriminatedUnion('kind', [
        z.object({
            kind: z.literal('builtin'),
            ref: z.string(),
        }),
        z.object({
            kind: z.literal('custom'),
            mimeType: z.union([z.literal('image/png'), z.literal('image/jpeg')]),
            base64: z.string(),
        }),
    ]),
    locale: z.string(),
});
