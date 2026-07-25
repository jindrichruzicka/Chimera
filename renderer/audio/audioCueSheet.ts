import type {
    AudioClipMetadata,
    AudioCueName,
} from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';

import type { Cue } from './Cue.js';

/**
 * The pure, fail-soft cue-sheet parser + cue resolver (§4.25 — Audio System →
 * Cue, Fade & Crossfade Extensions). This is the ONLY renderer-side reader of the
 * opaque `AudioClipMetadata` a game authors onto an audio clip (Invariant #124);
 * `simulation/`/`ai/` never import back from here.
 *
 * Resolution is FAIL-SOFT and NEVER throws into a caller (Invariant #118). These
 * functions also never call a logger — they RETURN the warning string in the
 * result so the `AudioManager` logs it later. That keeps "exactly one warning" a
 * pure, synchronous property of the return value.
 *
 * All range checks use the decoded `buffer.duration` passed as `ctx.duration`,
 * never the sheet's authoring-time `durationSeconds`.
 */

/** Whether a cue is a load-bearing anchor (`from`) or a clampable end-point (`to`, `loopEnd`). */
export type CueRole = 'anchor' | 'endpoint';

/** The result of resolving a single {@link Cue} to seconds. An `endpoint` role never yields `abandon`. */
export type CueResolution =
    | { readonly kind: 'resolved'; readonly seconds: number }
    | { readonly kind: 'abandon'; readonly warning: string };

/** The result of resolving a `[from, to]` window. `abandon`/`dropped` are consequence-neutral. */
export type CueWindowResolution =
    | {
          readonly kind: 'window';
          readonly startSeconds: number;
          readonly endSeconds: number;
          readonly durationSeconds: number;
      }
    | { readonly kind: 'abandon'; readonly warning: string }
    | { readonly kind: 'dropped'; readonly warning: string };

/**
 * Validate opaque manifest metadata into a typed {@link AudioClipMetadata}, or
 * `null` for absent/malformed input (Invariant #118). Never throws. Returns a
 * freshly-built object carrying only the known fields (unknown keys are dropped);
 * the input is never mutated.
 *
 * Well-formedness: every `cues` value is a finite number in `[0, durationSeconds]`;
 * `defaultLoopRegion` is a 2-tuple whose both names exist in `cues` with
 * `cues[end] > cues[start]`; a sheet declaring `cues` or `defaultLoopRegion`
 * requires a finite, non-negative `durationSeconds` (Invariant #125). Enforcing
 * `cue ≤ durationSeconds` here proves sheet self-consistency (defense-in-depth
 * beyond the build-time `validate-assets` gate) — NOT playability, since the
 * authoring `durationSeconds` may differ from the decoded `buffer.duration`.
 */
export function parseAudioCueSheet(metadata: unknown): AudioClipMetadata | null {
    if (!isPlainObject(metadata)) {
        return null;
    }

    const rawCues = metadata['cues'];
    const rawRegion = metadata['defaultLoopRegion'];
    const rawDuration = metadata['durationSeconds'];

    const hasCues = rawCues !== undefined;
    const hasRegion = rawRegion !== undefined;

    let durationSeconds: number | undefined;
    if (rawDuration !== undefined) {
        if (!isFiniteNonNegative(rawDuration)) {
            return null;
        }
        durationSeconds = rawDuration;
    }

    // A sheet that declares cues or a loop region MUST carry durationSeconds.
    if ((hasCues || hasRegion) && durationSeconds === undefined) {
        return null;
    }

    let cues: Record<string, number> | undefined;
    if (hasCues) {
        if (!isPlainObject(rawCues) || durationSeconds === undefined) {
            return null;
        }
        const validated: Record<string, number> = {};
        for (const [name, value] of Object.entries(rawCues)) {
            if (!isFiniteNonNegative(value) || value > durationSeconds) {
                return null;
            }
            validated[name] = value;
        }
        cues = validated;
    }

    let defaultLoopRegion: [string, string] | undefined;
    if (hasRegion) {
        if (!Array.isArray(rawRegion) || rawRegion.length !== 2) {
            return null;
        }
        const region = rawRegion as readonly unknown[];
        const start = region[0];
        const end = region[1];
        if (typeof start !== 'string' || typeof end !== 'string' || cues === undefined) {
            return null;
        }
        const startSeconds = cues[start];
        const endSeconds = cues[end];
        if (startSeconds === undefined || endSeconds === undefined || endSeconds <= startSeconds) {
            return null;
        }
        defaultLoopRegion = [start, end];
    }

    const sheet: {
        cues?: Readonly<Record<AudioCueName, number>>;
        defaultLoopRegion?: readonly [AudioCueName, AudioCueName];
        durationSeconds?: number;
    } = {};
    if (cues !== undefined) {
        sheet.cues = cues;
    }
    if (defaultLoopRegion !== undefined) {
        sheet.defaultLoopRegion = defaultLoopRegion;
    }
    if (durationSeconds !== undefined) {
        sheet.durationSeconds = durationSeconds;
    }
    return sheet;
}

/**
 * Resolve a single {@link Cue} to seconds against a decoded clip (fail-soft):
 * - `number` / `'start'` resolve synchronously; `'end'` and an absent `{ name }`
 *   lean on `ctx.duration`.
 * - A load-bearing `anchor` cue that is unresolvable (absent `{ name }`, or a
 *   value beyond `duration`, or non-finite) abandons with one warning.
 * - An `endpoint` cue clamps to `[0, duration]` and never abandons.
 */
export function resolveCue(
    cue: Cue,
    ctx: {
        readonly sheet: AudioClipMetadata | null;
        readonly duration: number;
        readonly role: CueRole;
    },
): CueResolution {
    const { sheet, duration, role } = ctx;

    if (cue === 'start') {
        return resolved(0);
    }
    if (cue === 'end') {
        return resolved(duration);
    }
    if (typeof cue === 'number') {
        return resolveNumeric(cue, duration, role, () => `${cue}s`);
    }

    // { name } — resolve against the clip's own sheet.
    const seconds = sheet?.cues?.[cue.name];
    if (seconds === undefined) {
        if (role === 'anchor') {
            return abandon(
                `Audio cue { name: "${cue.name}" } is unresolvable (anchor): not found in the clip's cue sheet; abandoning playback.`,
            );
        }
        return resolved(duration); // end-point degrades to end-of-buffer
    }
    return resolveNumeric(seconds, duration, role, () => `{ name: "${cue.name}" }`);
}

/**
 * Resolve a `[from, to]` window to `[startSeconds, endSeconds]` (fail-soft, the
 * DYNAMIC tier only). `from` is a load-bearing anchor; `to` an end-point. If the
 * window collapses (`end ≤ start`) after clamping it is dropped and playback
 * continues. Emits at most ONE warning: an unresolvable `from` short-circuits to
 * `abandon` without resolving `to`.
 *
 * This never reports the STATIC-reject outcome (both bounds synchronously finite
 * and `to ≤ from` → invalid handle, no voice) — that gate is a separate
 * synchronous check the `AudioManager` runs first, before calling this.
 */
export function resolveCueWindow(
    from: Cue,
    to: Cue,
    ctx: { readonly sheet: AudioClipMetadata | null; readonly duration: number },
): CueWindowResolution {
    const { sheet, duration } = ctx;

    const fromResult = resolveCue(from, { sheet, duration, role: 'anchor' });
    if (fromResult.kind === 'abandon') {
        return { kind: 'abandon', warning: fromResult.warning };
    }

    const toResult = resolveCue(to, { sheet, duration, role: 'endpoint' });
    const startSeconds = fromResult.seconds;
    // An endpoint never abandons; the fallback keeps the union exhaustive for TS.
    const endSeconds = toResult.kind === 'resolved' ? toResult.seconds : duration;

    if (endSeconds <= startSeconds) {
        return {
            kind: 'dropped',
            warning: `Audio cue window [${startSeconds}s, ${endSeconds}s] collapsed after clamping to [0, ${duration}s]; dropping the window and continuing playback.`,
        };
    }

    return {
        kind: 'window',
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
    };
}

// ─── internals ──────────────────────────────────────────────────────────────────

function resolveNumeric(
    value: number,
    duration: number,
    role: CueRole,
    describe: () => string,
): CueResolution {
    if (!Number.isFinite(value)) {
        return role === 'anchor'
            ? abandon(`Audio cue ${describe()} is non-finite (anchor); abandoning playback.`)
            : resolved(duration);
    }
    if (value < 0) {
        return resolved(0); // low-clamp, benign "from the start"
    }
    if (value > duration) {
        return role === 'anchor'
            ? abandon(
                  `Audio cue ${describe()} is beyond clip duration ${duration}s (anchor); abandoning playback.`,
              )
            : resolved(duration); // high-clamp
    }
    return resolved(value);
}

function resolved(seconds: number): CueResolution {
    return { kind: 'resolved', seconds };
}

function abandon(warning: string): CueResolution {
    return { kind: 'abandon', warning };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
