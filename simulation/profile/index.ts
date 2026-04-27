/**
 * simulation/profile/index.ts
 *
 * Public API barrel for the simulation/profile sub-module.
 *
 * Re-exports all profile types and interfaces so consumers import from
 * `@chimera/simulation/profile` rather than internal module paths.
 *
 * Populated progressively as F14 tasks land:
 *   - T1 (#338): ProfileSchema types, ProfileRepository interface, EngineProfileSchema
 *   - T2 (#339): ProfileSanitizer.admit() with all 7 rejection types
 */

export type {
    LocalProfileId,
    AvatarSource,
    EngineProfile,
    GameProfileSchema,
    PlayerProfile,
    ProfileRepository,
} from './ProfileSchema.js';
export { localProfileId, EngineProfileSchema } from './ProfileSchema.js';

export type { AdmissionRejection, AdmissionResult } from './ProfileSanitizer.js';
export {
    admit,
    MAX_DISPLAY_NAME_LENGTH,
    MAX_CUSTOM_AVATAR_BYTES,
    ALLOWED_AVATAR_MIME_TYPES,
    RESERVED_ID_PREFIXES,
} from './ProfileSanitizer.js';
