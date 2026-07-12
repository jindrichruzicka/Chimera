/**
 * Public API barrel for the simulation/profile sub-module.
 *
 * Re-exports all profile types and interfaces so consumers import from
 * `@chimera-engine/simulation/profile` rather than internal module paths.
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

export { InMemoryProfileRepository } from './InMemoryProfileRepository.js';
