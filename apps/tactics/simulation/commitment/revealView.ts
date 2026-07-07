/**
 * apps/tactics/commitment/revealView.ts
 *
 * Renderer-side narrowing of a verified commitment reveal back to the tactics
 * committed turn (F54 / T9), so the board can play back / animate each revealed
 * turn. The main process already gated the reveal through
 * `CommitmentScheme.verify()` (Invariant #9); this is a structural re-narrow of
 * the opaque `reveal.value` (defence in depth) using the same schema the host
 * stages with.
 *
 * Typed on `{ value: unknown }` rather than the preload `CommitmentReveal` so the
 * tactics game package never imports `electron/*` (module boundary).
 */

import { TacticsCommitmentEnvelopeValueSchema } from './bufferSchema.js';
import type { TacticsCommitmentEnvelopeValue } from './contract.js';

/**
 * Narrow a verified reveal's opaque value to the tactics committed turn, or
 * `null` when absent or malformed (the board then renders nothing extra).
 */
export function parseRevealedTurn(
    reveal: { readonly value: unknown } | null | undefined,
): TacticsCommitmentEnvelopeValue | null {
    if (reveal === null || reveal === undefined) {
        return null;
    }
    const parsed = TacticsCommitmentEnvelopeValueSchema.safeParse(reveal.value);
    return parsed.success ? parsed.data : null;
}
