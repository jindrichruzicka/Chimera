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

export { assertNoLeakedFields, ObfuscationAssertionError } from './assertNoLeakedFields.js';

export type {
    CommitmentEnvelope,
    CommitmentId,
    CommitmentReveal,
    CommitmentScheme,
} from './CommitmentScheme.js';
export {
    CommitmentVerificationError,
    DefaultCommitmentScheme,
    toCommitmentId,
} from './CommitmentScheme.js';
