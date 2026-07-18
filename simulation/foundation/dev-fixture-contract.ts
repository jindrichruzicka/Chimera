/**
 * shared/dev-fixture-contract.ts
 *
 * Shared declarative contract for the dev multiplayer harness fixtures (§4.32):
 * the game-owned test data a developer authors under `<appRoot>/dev/` so the
 * harness can boot an instantly-running multiplayer session.
 *
 *   - `DevScenarioSchema` — one scenario file (`dev/scenarios/<name>.json`):
 *     the human seat list (each with an optional profile-file ref and
 *     game-defined per-seat attributes such as a card game's deck), optional
 *     AI seats, host-authored match settings (arena, turn mode, …) and the
 *     auto-start switch.
 *   - `DevAnnounceSchema` — the tiny handshake payload the auto-hosting
 *     instance writes inside its OWN userData dir (Invariant #78) so the
 *     orchestrator can learn the full `host:port:token` lobby code.
 *
 * Seat `attributes` values are opaque strings with game-defined vocabulary —
 * exactly the per-seat lobby attributes that flow into
 * `GameSetupConfig.playerAttributes` → `snapshot.setup` (§4.37). A structured
 * payload (e.g. a deck) is JSON-encoded by the game's own convention; the
 * engine never interprets it. Profile files are validated separately with
 * `EngineProfileSchema` (profiles stay cosmetic — Invariant #59), so this
 * module carries no profile schema.
 *
 * Consumed by the harness CLI (spawn planning) and by `electron/main/dev/*`
 * (instance-side seeding); both re-validate at their own JSON boundaries.
 * Pure data + pure helpers only — zero I/O, no environment reads, and zero
 * imports beyond sibling `shared/` modules (mirroring `messages-schemas.ts`
 * local invariant #2 — nothing from renderer/, electron/, or DOM APIs).
 */

import { z } from 'zod';

import {
    WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
} from './messages-schemas.js';

/** Version stamp for the fixture file formats; bump on breaking shape changes. */
export const DEV_FIXTURE_SCHEMA_VERSION = 1;

/**
 * Maximum human seats a scenario may declare. Matches the harness spawn cap
 * (`MAX_PLAYERS` — one Electron instance per human seat).
 */
export const DEV_SCENARIO_MAX_SEATS = 8;

/** Maximum host-added AI seats a scenario may declare. */
export const DEV_SCENARIO_MAX_AI_SEATS = 7;

/**
 * A seat's profile-file reference: a bare `*.json` filename resolved under the
 * app's `dev/profiles/` directory. Bare-name only — no path separators, no
 * leading dot — so a fixture can never traverse outside the profiles dir.
 */
const DevProfileRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/);

/**
 * Per-seat attributes: game-defined keys/values, capped at the coarse wire
 * bounds (the precise per-game cap is enforced by the host at runtime via
 * `resolveAttributeValueCap`).
 */
const DevSeatAttributes = z.record(
    z.string().min(1).max(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH),
    z.string().max(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH),
);

/** One human seat in a dev scenario. */
export const DevSeatSchema = z
    .object({
        /** Profile file under `dev/profiles/`; absent ⇒ a generated default profile. */
        profile: DevProfileRef.optional(),
        /** Game-defined per-seat match data (deck, faction, colour, …). */
        attributes: DevSeatAttributes.optional(),
        /** Auto-ready this seat. Default true; false lets a dev drive the ready flow. */
        ready: z.boolean().optional(),
    })
    .strict();
export type DevSeat = z.infer<typeof DevSeatSchema>;

/**
 * One scenario file. `.strict()` throughout so a typo (`autostart`) fails
 * loudly at the CLI instead of silently launching a default session.
 */
export const DevScenarioSchema = z
    .object({
        schemaVersion: z.literal(DEV_FIXTURE_SCHEMA_VERSION).optional(),
        /** When present, must equal the hosted game's id; the host refuses otherwise. */
        gameId: z.string().min(1).optional(),
        /** Human seats, in join order; seat 1 is the host. */
        seats: z.array(DevSeatSchema).min(1).max(DEV_SCENARIO_MAX_SEATS),
        /** Host-side `addAi()` count appended after the human seats. Default 0. */
        aiSeats: z.number().int().min(0).max(DEV_SCENARIO_MAX_AI_SEATS).optional(),
        /** Host-authored match settings merged over the game's lobbySetup defaults. */
        matchSettings: z.record(z.string().min(1), z.string()).optional(),
        /** Start the match once the roster is complete and every seat is ready. Default true. */
        autoStart: z.boolean().optional(),
    })
    .strict();
export type DevScenario = z.infer<typeof DevScenarioSchema>;

/**
 * The announce payload the auto-hosting instance writes (atomically) inside
 * its own userData dir once the lobby is fully seeded. Doubles as the
 * orchestrator's "host is ready for joiners" barrier.
 */
export const DevAnnounceSchema = z
    .object({
        schemaVersion: z.literal(DEV_FIXTURE_SCHEMA_VERSION).optional(),
        /** Full join code (`host:port:token`) minted by the hosting provider. */
        lobbyCode: z.string().min(1),
        gameId: z.string().min(1),
    })
    .strict();
export type DevAnnounce = z.infer<typeof DevAnnounceSchema>;

// ─── Pure helpers (never throw) ───────────────────────────────────────────────

/** Number of human seats (= Electron instances the harness spawns). */
export function devScenarioHumanSeats(scenario: DevScenario): number {
    return scenario.seats.length;
}

/** Lobby seat cap for `hostLobby`: human seats plus declared AI seats. */
export function devScenarioMaxPlayers(scenario: DevScenario): number {
    return scenario.seats.length + (scenario.aiSeats ?? 0);
}

/**
 * The seat at 1-based `seatNumber` (seat 1 = host, matching the harness's
 * `p1..pN` instance labels). `undefined` when out of range.
 */
export function devScenarioSeat(scenario: DevScenario, seatNumber: number): DevSeat | undefined {
    if (!Number.isInteger(seatNumber) || seatNumber < 1) {
        return undefined;
    }
    return scenario.seats[seatNumber - 1];
}

/** Whether the host should auto-start the match. Absent ⇒ true. */
export function devScenarioAutoStart(scenario: DevScenario): boolean {
    return scenario.autoStart ?? true;
}

/** Whether a seat should auto-ready. Absent seat or flag ⇒ true. */
export function devSeatReady(seat: DevSeat | undefined): boolean {
    return seat?.ready ?? true;
}

// ─── Generated fallback profile ids ───────────────────────────────────────────

const GENERATED_DEV_PROFILE_ID = /^dev-p([1-9][0-9]*)$/;

/**
 * The no-fixture fallback profile id for a 1-based seat: the id the harness
 * CLI passes via `--dev-profile-id` when a seat has no profile file, and the
 * id the instance recognises to seed a generated "Dev Player N" identity.
 * One shared contract so the emitting and recognising sides can never drift.
 */
export function generatedDevProfileId(seatNumber: number): string {
    return `dev-p${seatNumber}`;
}

/**
 * Inverse of {@link generatedDevProfileId}: the 1-based seat number encoded in
 * a generated fallback id, or `undefined` for any other id (which then flows
 * through normal profile resolution untouched). Never throws.
 */
export function matchGeneratedDevProfileSeat(profileId: string): number | undefined {
    const match = GENERATED_DEV_PROFILE_ID.exec(profileId);
    return match === null ? undefined : Number.parseInt(match[1]!, 10);
}
