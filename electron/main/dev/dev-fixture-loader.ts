/**
 * electron/main/dev/dev-fixture-loader.ts
 *
 * Fixture I/O for the dev multiplayer harness (§4.32): loads the game-owned
 * `dev/` fixture files (scenario + seed profiles) an instance was pointed at
 * via `--dev-scenario-file` / `--dev-profile-file`, and writes the host's
 * announce file (`--dev-announce-file`) the orchestrator polls for the lobby
 * code.
 *
 * Part of the self-contained dev graph under `electron/main/dev/` — reached
 * only via the harness-gated dynamic import in `index.ts` (the Invariant #27
 * pattern: the gate is runtime, file presence is not). Every `JSON.parse`
 * boundary is Zod-validated (§8.3) and every write is atomic (`.tmp` +
 * rename, mirroring `FileProfileRepository.save`). All filesystem access goes
 * through the injected {@link DevFixtureIo} (defaulting to `fs/promises`) so
 * unit tests never touch the real filesystem.
 *
 * Invariants upheld:
 *   #59 — profiles seeded here are engine-shaped only; unknown game fields
 *          are stripped by `EngineProfileSchema` (zod drops unknown keys), so
 *          a seeded profile is always wire-safe for the strict JOIN attestation.
 *   #77 — this module is only ever imported when `CHIMERA_DEV_HARNESS=1`.
 *   #78 — the announce file is written INSIDE the writing instance's own
 *          userData dir; siblings never read each other's dirs (only the
 *          orchestrator reads the announce file).
 */

import * as fs from 'fs/promises';

import { z } from 'zod';

import {
    DevScenarioSchema,
    matchGeneratedDevProfileSeat,
    type DevAnnounce,
    type DevScenario,
} from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';
import { buildAssetRef, type TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import {
    EngineProfileSchema,
    localProfileId as toLocalProfileId,
    type LocalProfileId,
    type PlayerProfile,
    type ProfileRepository,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';

/**
 * Minimal filesystem port. Defaults to `fs/promises`; tests inject an
 * in-memory double (unit tests must not touch the real FS).
 */
export interface DevFixtureIo {
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
}

const defaultIo: DevFixtureIo = {
    readFile: (path) => fs.readFile(path, 'utf8'),
    writeFile: (path, data) => fs.writeFile(path, data, 'utf8'),
    rename: (from, to) => fs.rename(from, to),
};

/** A fixture file could not be read, parsed, or validated. Always names the file. */
export class DevFixtureError extends Error {
    readonly code = 'DEV_FIXTURE' as const;
    constructor(message: string) {
        super(message);
        this.name = 'DevFixtureError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** Read + JSON.parse a fixture file, wrapping every failure into DevFixtureError. */
async function readJson(path: string, io: DevFixtureIo): Promise<unknown> {
    let raw: string;
    try {
        raw = await io.readFile(path);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new DevFixtureError(`Cannot read dev fixture ${path}: ${message}`);
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new DevFixtureError(`Dev fixture ${path} is not valid JSON: ${message}`);
    }
}

/** Render zod issues via zod's canonical formatter for the thrown error. */
function formatIssues(error: z.ZodError): string {
    return z.prettifyError(error);
}

/** Load + validate a scenario file (`dev/scenarios/<name>.json`). */
export async function loadDevScenario(
    path: string,
    io: DevFixtureIo = defaultIo,
): Promise<DevScenario> {
    const parsed = DevScenarioSchema.safeParse(await readJson(path, io));
    if (!parsed.success) {
        throw new DevFixtureError(`Dev scenario ${path} is invalid: ${formatIssues(parsed.error)}`);
    }
    return parsed.data;
}

/**
 * Load + validate a seed-profile file (`dev/profiles/<name>.json`). Unknown
 * (game-extended) fields are tolerated in the file and STRIPPED here — the
 * result is always the engine-shaped, wire-safe profile (Invariant #59).
 */
export async function loadDevProfileFile(
    path: string,
    io: DevFixtureIo = defaultIo,
): Promise<PlayerProfile> {
    const parsed = EngineProfileSchema.safeParse(await readJson(path, io));
    if (!parsed.success) {
        throw new DevFixtureError(`Dev profile ${path} is invalid: ${formatIssues(parsed.error)}`);
    }
    // EngineProfileSchema validates all structural constraints; AssetRef<T> and
    // LocalProfileId are phantom brands with no runtime representation. The cast
    // is safe because safeParse() has already verified the shape (the same
    // documented cast site as FileProfileRepository.load).
    const validated = parsed.data as unknown as PlayerProfile;
    return { ...validated, localProfileId: toLocalProfileId(validated.localProfileId) };
}

/**
 * Seed a fixture profile into the repository — the documented §4.32 seed-copy:
 * load the file, then persist it so normal profile resolution
 * (`ensureActiveProfile`) picks it up as the instance's active profile.
 * Returns the seeded profile's id.
 */
export async function seedDevProfile(
    repository: ProfileRepository,
    path: string,
    io: DevFixtureIo = defaultIo,
): Promise<LocalProfileId> {
    const profile = await loadDevProfileFile(path, io);
    await repository.save(profile);
    return profile.localProfileId;
}

/**
 * No-fixture fallback: give a `--dev-profile-id=dev-p<N>` instance a distinct
 * "Dev Player N" identity instead of the generic default ('Player' for every
 * seat). Generated in code — no fixture file needed, so a bare
 * `pnpm dev:mp 3` works in a standalone scaffold with zero authored dev data.
 * The id vocabulary is the shared `generatedDevProfileId` contract, so the
 * emitting CLI and this recogniser can never drift. A non-matching id returns
 * `undefined` (normal profile resolution applies), and an already-persisted
 * profile is never overwritten.
 */
export async function seedGeneratedDevProfile(
    repository: ProfileRepository,
    rawProfileId: string,
): Promise<LocalProfileId | undefined> {
    const seatNumber = matchGeneratedDevProfileSeat(rawProfileId);
    if (seatNumber === undefined) {
        return undefined;
    }
    const profileId = toLocalProfileId(rawProfileId);
    if ((await repository.load(profileId)) !== null) {
        return profileId;
    }
    await repository.save({
        localProfileId: profileId,
        displayName: `Dev Player ${seatNumber}`,
        avatar: { kind: 'builtin', ref: buildAssetRef<TextureAsset>('avatar', 'default') },
        locale: 'en-US',
    });
    return profileId;
}

/**
 * Atomically write the host's announce payload (`.tmp` + rename) so the
 * polling orchestrator can never observe a torn half-written file. The caller
 * passes a path inside the instance's OWN userData dir (Invariant #78).
 */
export async function writeDevAnnounceFile(
    path: string,
    announce: DevAnnounce,
    io: DevFixtureIo = defaultIo,
): Promise<void> {
    const tmp = `${path}.tmp`;
    await io.writeFile(tmp, JSON.stringify(announce));
    await io.rename(tmp, path);
}
