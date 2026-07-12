/**
 * simulation/persistence/SessionManifest.ts
 *
 * Derives a best-effort `SaveSessionManifest` from a checkpoint snapshot.
 * Shared by the v5→v6 `sessionManifestMigration` (legacy saves
 * carry no manifest) and by `captureSaveFile`'s fallback when the host wires
 * no live manifest provider, so the two paths can never drift.
 *
 * Runs only at the persistence load/save boundary — never inside
 * `validate()`/`reduce()` — so the minted-UUID fallback does not touch
 * simulation determinism (Invariant #43 applies to reducers).
 *
 * Invariants upheld:
 *   #2  — no Node.js or Electron imports; `globalThis.crypto` is a Web API
 *         global (same justification as SaveChecksum).
 *   #59 — seats carry raw ids and control kinds only, no profile data.
 */

import type { BaseGameSnapshot } from '../engine/types.js';
import { playerId } from '../engine/types.js';
import type { SaveSeat, SaveSessionManifest } from './SaveFile.js';

/**
 * Synthetic AI seat ids are minted as `ai-<slotIndex>` (HostedSessionAgents).
 * No leading zeros — `createSyntheticAIPlayerId` interpolates a number — so a
 * zero-padded lookalike (`ai-01`) is NOT an engine-minted AI seat and must not
 * claim (and possibly collide on) the slot its numeric value implies.
 */
const AI_ID_RE = /^ai-(0|[1-9]\d*)$/;

/**
 * Backfill a session manifest from checkpoint state alone.
 *
 * Slot assignment is collision-free by construction: AI ids first claim their
 * authoritative `ai-<n>` suffix slot (the suffix IS the seat they were minted
 * for), then the remaining seats fill the lowest free indexes in
 * `checkpoint.players` key order. Control heuristics for non-AI ids: the
 * `hostPlayerId` is `host`; an id containing `-local-` is `local`; anything
 * else is `remote`. Best-effort orchestration hints for legacy saves, pinned
 * by tests. `omniscient` is unknowable from a checkpoint and is always
 * omitted.
 *
 * `maxPlayers` is a floor, not the recorded lobby capacity (legacy saves never
 * stored one): `max(seat count, highest slotIndex + 1)`, so every seat is
 * guaranteed in range. The live manifest built in `electron/main/index.ts`
 * records the real capacity instead — restore consumers should treat a
 * derived value as a lower bound.
 *
 * The matchId adopts `checkpoint.matchId` when present; a legacy checkpoint
 * without one gets a freshly minted UUID (no client holds a ticket for a
 * legacy save, so the join-order fallback covers reclaim).
 */
export function deriveSessionManifest(checkpoint: BaseGameSnapshot): SaveSessionManifest {
    const ids = Object.keys(checkpoint.players);

    // Pass 1: AI seats claim their authoritative suffix slots.
    const claimed = new Set<number>();
    const aiSlotById = new Map<string, number>();
    for (const id of ids) {
        const aiMatch = AI_ID_RE.exec(id);
        if (aiMatch !== null) {
            const slotIndex = Number(aiMatch[1]);
            aiSlotById.set(id, slotIndex);
            claimed.add(slotIndex);
        }
    }

    // Pass 2: non-AI seats fill the lowest free indexes in key order.
    let nextFree = 0;
    const seats: SaveSeat[] = ids.map((id) => {
        const pid = playerId(id);
        const aiSlot = aiSlotById.get(id);
        if (aiSlot !== undefined) {
            return { playerId: pid, control: 'ai', slotIndex: aiSlot };
        }
        while (claimed.has(nextFree)) {
            nextFree += 1;
        }
        const slotIndex = nextFree;
        claimed.add(slotIndex);
        if (id === checkpoint.hostPlayerId) {
            return { playerId: pid, control: 'host', slotIndex };
        }
        if (id.includes('-local-')) {
            return { playerId: pid, control: 'local', slotIndex };
        }
        return { playerId: pid, control: 'remote', slotIndex };
    });

    const highestSlot = seats.reduce((max, seat) => Math.max(max, seat.slotIndex), -1);
    return {
        matchId: checkpoint.matchId ?? globalThis.crypto.randomUUID(),
        maxPlayers: Math.max(seats.length, highestSlot + 1),
        seats,
    };
}
