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
