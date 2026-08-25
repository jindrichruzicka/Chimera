// simulation/foundation/save-slots.ts
// Save / load persistence → the autosave slot, §4.11.
//
// The engine writes one reserved slot per game and rewrites it on every
// autosave. Its name lives here and nowhere else in production: one bare name,
// one function that qualifies it, and `tools/autosave-slot-spelling.test.ts`
// failing on any other production spelling of either. Several modules have to
// agree on this name — the header stamper, the writer, and every reader of the
// qualified id — and a literal at each of them is an agreement nothing checks.
//
// Both halves are needed because the slot is written under one spelling and
// read under the other. A `SaveFile` header carries the BARE name
// (`AUTOSAVE_SLOT_NAME`); the repository keys, lists and deletes by the
// QUALIFIED `'<gameId>/<slotName>'` id (`autosaveSlotId`), which is also what
// `SaveSlotMeta.slotId` carries into the renderer.
//
// This module carries runtime values, so — like `foundation/time-scale.ts` and
// `foundation/crc32.ts` — it is NOT re-exported from `simulation/index.ts` or
// `simulation/contracts/index.ts`, both of which are asserted to bundle to the
// empty string (Invariant #1). Its own subpath is the way in.
//
// Zero-dependency leaf: this module imports nothing.

/**
 * The bare name of the reserved autosave slot, as it appears in
 * `SaveFile.header.slotId`.
 *
 * Never build a qualified id by hand from this — use {@link autosaveSlotId},
 * so the separator lives in one place too.
 */
export const AUTOSAVE_SLOT_NAME = 'autosave';

/**
 * The fully-qualified repository id of a game's autosave slot: the form
 * `SaveRepository.list` returns, and the form `load` / `delete` / `has` take.
 *
 * @param gameId the owning game's id, e.g. `'tactics'`
 * @returns e.g. `'tactics/autosave'`
 */
export function autosaveSlotId(gameId: string): string {
    return `${gameId}/${AUTOSAVE_SLOT_NAME}`;
}
