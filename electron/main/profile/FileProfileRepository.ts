/**
 * electron/main/profile/FileProfileRepository.ts
 *
 * Filesystem-backed `ProfileRepository` implementation (§4.24, invariant #60).
 *
 * Profiles are stored as one JSON file per profile under `baseDir`:
 *
 *   <baseDir>/<localProfileId>.json
 *
 * `save()` always writes to a `.tmp` file first, then renames atomically to
 * the final path. An in-progress crash therefore leaves a `.tmp` artefact that
 * is invisible to `load()` / `listLocalSlots()` and will be overwritten on the
 * next `save()` call.
 *
 * The default `baseDir` is `app.getPath('userData')/profiles` from Electron.
 * In tests, supply a custom `baseDir` pointing to a temp directory.
 *
 * Architecture reference: §4.24
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, games/*, or any DOM API.
 *   #60 — Persists only the local machine's profiles. Remote clients'
 *         profiles never reach this class.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import type {
    LocalProfileId,
    PlayerProfile,
    ProfileRepository,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';
import {
    localProfileId as toLocalProfileId,
    EngineProfileSchema,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';

/** Extension used for persisted profile files. */
const FILE_EXT = '.json';

/**
 * Maximum number of profile files read in parallel by `listLocalSlots()`.
 *
 * Mirrors the `LIST_CONCURRENCY` constant in `FileSaveRepository` to prevent
 * EMFILE errors when a user has a large number of profile slots.
 */
export const LIST_CONCURRENCY = 16;

/**
 * Allowlist pattern for `localProfileId` values used as path components.
 *
 * Mirrors the slot-component pattern used by `FileSaveRepository` (with
 * uppercase letters allowed since profile IDs are typically opaque/randomly
 * generated). This guards against path traversal (OWASP A01).
 */
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Thrown when a `localProfileId` fails the allowlist validation that prevents
 * path traversal.
 *
 * Allowed pattern: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`
 */
export class InvalidLocalProfileIdError extends Error {
    constructor(value: string) {
        super(
            `Invalid localProfileId ${JSON.stringify(value)}: must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`,
        );
        this.name = 'InvalidLocalProfileIdError';
    }
}

function validateProfileId(value: string): void {
    if (!PROFILE_ID_RE.test(value)) {
        throw new InvalidLocalProfileIdError(value);
    }
}

/**
 * Filesystem-backed `ProfileRepository`. One JSON file per profile.
 *
 * `baseDir` is injected by the Electron main process; in production it is
 * `app.getPath('userData') + '/profiles'`. Tests pass an explicit temp path
 * to avoid touching the real user directory.
 */
export class FileProfileRepository implements ProfileRepository {
    constructor(private readonly baseDir: string) {}

    // ── Private helpers ──────────────────────────────────────────────────

    private profilePath(id: string): string {
        return path.join(this.baseDir, `${id}${FILE_EXT}`);
    }

    // ── ProfileRepository implementation ─────────────────────────────────

    async load(id: LocalProfileId): Promise<PlayerProfile | null> {
        validateProfileId(id);

        let raw: string;
        try {
            raw = await fs.readFile(this.profilePath(id), 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            throw err;
        }

        // Validate the stored JSON against the schema before trusting its shape.
        // An invalid file (corrupted, hand-edited, or from a future schema version)
        // is treated as missing — the caller receives null rather than malformed data.
        const result = EngineProfileSchema.safeParse(JSON.parse(raw));
        if (!result.success) {
            return null;
        }
        // EngineProfileSchema validates all structural constraints; AssetRef<T>
        // and LocalProfileId are phantom brands with no runtime representation.
        // The cast is safe because safeParse() has already verified the shape.
        const validated = result.data as unknown as PlayerProfile;
        return {
            ...validated,
            localProfileId: toLocalProfileId(validated.localProfileId),
        };
    }

    async save(profile: PlayerProfile): Promise<void> {
        validateProfileId(profile.localProfileId);

        await fs.mkdir(this.baseDir, { recursive: true });

        const dest = this.profilePath(profile.localProfileId);
        const tmp = `${dest}.tmp`;
        const payload = JSON.stringify(profile);

        const fh = await fs.open(tmp, 'w');
        try {
            await fh.writeFile(payload, 'utf8');
            await fh.sync();
        } finally {
            await fh.close();
        }

        try {
            await fs.rename(tmp, dest);
        } catch (err) {
            await fs.unlink(tmp).catch(() => undefined); // best-effort cleanup
            throw err;
        }
    }

    async listLocalSlots(): Promise<
        readonly { readonly localProfileId: LocalProfileId; readonly displayName: string }[]
    > {
        const entries = await fs.readdir(this.baseDir).catch((err: unknown): string[] => {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        });

        const jsonNames = entries.filter(
            (name) => name.endsWith(FILE_EXT) && !name.endsWith('.tmp'),
        );

        // Read files in bounded parallel chunks to prevent EMFILE exhaustion
        // and avoid holding all full profile payloads in memory simultaneously.
        const readSlot = async (
            name: string,
        ): Promise<{
            readonly localProfileId: LocalProfileId;
            readonly displayName: string;
        } | null> => {
            const raw = await fs.readFile(path.join(this.baseDir, name), 'utf8');
            const result = EngineProfileSchema.safeParse(JSON.parse(raw));
            if (!result.success) {
                // Skip corrupted or schema-invalid profile files without crashing.
                return null;
            }
            return {
                localProfileId: toLocalProfileId(result.data.localProfileId),
                displayName: result.data.displayName,
            };
        };

        const slots: { readonly localProfileId: LocalProfileId; readonly displayName: string }[] =
            [];
        for (let i = 0; i < jsonNames.length; i += LIST_CONCURRENCY) {
            const chunk = jsonNames.slice(i, i + LIST_CONCURRENCY);
            const results = await Promise.all(chunk.map(readSlot));
            for (const slot of results) {
                if (slot !== null) slots.push(slot);
            }
        }

        return slots;
    }

    async delete(id: LocalProfileId): Promise<void> {
        validateProfileId(id);

        try {
            await fs.unlink(this.profilePath(id));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw err;
        }
    }
}
