// simulation/content/audioManifest.ts
// §4.25 — Audio System → Cue authoring surface (sim side).
//
// The write-only authoring builder games call to attach an AudioClipMetadata
// cue sheet to an 'audio-clip' manifest entry. It only WRITES the value into
// the existing AssetManifestEntry.metadata slot (typed `unknown`); it never
// reads or parses it. AudioCueName/AudioClipMetadata are defined sim-side
// (../foundation/audio-cue-sheet) and flow sim → renderer — the sole parser /
// resolver is renderer/audio, never the reverse (Invariant #124, extends #20).
//
// AssetManifestEntry itself is unchanged (metadata?: unknown).
//
// Zero-dependency leaf edge: imports only within simulation/ — no renderer,
// DOM, React, Electron, or Three.js (Invariant #1).

import type { AssetManifestEntry, AssetPriority } from './AssetManifest.js';
import type { AssetRef, AudioClipAsset } from './AssetRef.js';
import type {
    AudioClipMetadata,
    AudioCueName,
    WellKnownAudioCueName,
} from '../foundation/audio-cue-sheet.js';

// Re-export the sim-side cue vocabulary so a game authors a cue sheet and its
// manifest entry from a single content-layer import site.
export type { AudioClipMetadata, AudioCueName, WellKnownAudioCueName };

/**
 * Build an `'audio-clip'` {@link AssetManifestEntry}, optionally carrying a cue
 * sheet in the opaque `metadata` slot.
 *
 * Write-only: the returned `metadata` is the passed {@link AudioClipMetadata}
 * verbatim and is never inspected here — the sole reader/resolver is
 * `renderer/audio` (Invariant #124). `AssetManifestEntry` stays `metadata?:
 * unknown`; this builder just fills the slot with a typed value at the call site.
 *
 * @param args.ref       A typed reference to the decoded audio clip.
 * @param args.priority  Load priority (`'critical'` preloads; `'deferred'` lazy-loads).
 * @param args.metadata  Optional cue sheet. Omit for a behaviour-neutral entry
 *                       identical to a hand-authored one (no `metadata` key).
 */
export function audioClipEntry(args: {
    readonly ref: AssetRef<AudioClipAsset>;
    readonly priority: AssetPriority;
    readonly metadata?: AudioClipMetadata;
}): AssetManifestEntry<AudioClipAsset> {
    if (args.metadata === undefined) {
        // No sheet → omit the key entirely (exactOptionalPropertyTypes), so the
        // entry deep-equals a manifest authored without this builder.
        return { ref: args.ref, kind: 'audio-clip', priority: args.priority };
    }
    return {
        ref: args.ref,
        kind: 'audio-clip',
        priority: args.priority,
        metadata: args.metadata, // verbatim; never inspected sim-side (Invariant #124)
    };
}
