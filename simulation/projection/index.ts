/**
 * Public API of the simulation projection sub-module.
 */

export type {
    ObservedEntityState,
    ObservedPlayerState,
    VisibilityRules,
    VisibilityScope,
} from './types.js';

export type { PlayerSnapshot, StateProjector, StateProjectorOptions } from './StateProjector.js';
export { DefaultStateProjector } from './StateProjector.js';

export type { CommitmentEnvelope, CommitmentReveal, CommitmentScheme } from './CommitmentScheme.js';
export { CommitmentVerificationError, DefaultCommitmentScheme } from './CommitmentScheme.js';
