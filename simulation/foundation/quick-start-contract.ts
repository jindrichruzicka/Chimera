/**
 * simulation/foundation/quick-start-contract.ts
 *
 * Pure data contract for a game's QUICK START — the one-click path from a shell
 * screen into a playable match, skipping the lobby (§4.37).
 *
 * A `QuickStartConfig` is the declarative answer to "what match do I open when
 * the player presses Play?": the host-authored match settings plus one entry
 * per seat. EVERY seat kind carries its own attributes — the host seat, each
 * pass-and-play local seat, and each AI seat — so a game whose seats differ by
 * character, colour, or faction can express that here. A bare seat COUNT would
 * not: it can say how many seats to open but not what any of them is playing,
 * which is why the seat lists hold objects.
 *
 * `chimera:lobby:quick-start` consumes this config; this module is the
 * contract both ends compile against.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 *
 * Module boundary (§3 Module Boundary Table): this is a ZERO-IMPORT foundation
 * leaf — it declares no import at all, so it can never take a back-edge onto
 * `renderer/`, `electron/`, or `apps/*`, and both the renderer and the main
 * process reach it on the ordinary contract path.
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code.
 */

/**
 * One quick-start seat. `attributes` are the same owner-authored per-seat
 * picks a lobby writes onto `LobbyPlayerEntry.attributes` (e.g. unit colour),
 * so a quick-started seat and a lobby-configured one reach `snapshot.setup`
 * through the identical carrier. Absent ⇒ the game's
 * `GameLobbySetup.resolveDefaultPlayerAttributes` seat defaults apply.
 */
export interface QuickStartSeat {
    readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * One quick-start AI seat: a {@link QuickStartSeat} plus the AI-only
 * omniscience flag carried by `LobbyAgentSlot.omniscient` (Invariant #17 — an
 * honest agent is seeded from a projected snapshot). Absent ⇒ honest.
 */
export interface QuickStartAiSeat extends QuickStartSeat {
    readonly omniscient?: boolean;
}

/**
 * A game's quick-start declaration. Every field is optional: an empty config
 * means "open a single-seat match with the game's own defaults".
 *
 * Seat lists are ordered; their length is the seat count. The host seat is
 * implicit (it is the session's own seat) and carries its picks in
 * {@link hostAttributes}, so it never appears in {@link localSeats}.
 */
export interface QuickStartConfig {
    /** Host-authored match settings, exactly as a lobby would broadcast them. */
    readonly matchSettings?: Readonly<Record<string, string>>;
    /** Per-seat attributes for the host's own seat (seat 0). */
    readonly hostAttributes?: Readonly<Record<string, string>>;
    /** Additional pass-and-play seats owned by this machine, in seat order. */
    readonly localSeats?: readonly QuickStartSeat[];
    /** AI seats to open, in seat order. */
    readonly aiSeats?: readonly QuickStartAiSeat[];
}
