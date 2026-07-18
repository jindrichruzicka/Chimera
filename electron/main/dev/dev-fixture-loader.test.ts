/**
 * electron/main/dev/dev-fixture-loader.test.ts
 *
 * Unit tests for the dev-harness fixture I/O module. All I/O goes through the
 * injected {@link DevFixtureIo} double — no real filesystem is touched.
 */

import { describe, expect, it } from 'vitest';

import { InMemoryProfileRepository } from '@chimera-engine/simulation/profile/InMemoryProfileRepository.js';
import { localProfileId } from '@chimera-engine/simulation/profile/ProfileSchema.js';
import { DevAnnounceSchema } from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';

import {
    DevFixtureError,
    loadDevProfileFile,
    loadDevScenario,
    seedDevProfile,
    seedGeneratedDevProfile,
    writeDevAnnounceFile,
    type DevFixtureIo,
} from './dev-fixture-loader.js';

/** Recording in-memory IO double. */
function makeIo(files: Record<string, string> = {}): DevFixtureIo & {
    readonly calls: string[];
    readonly store: Record<string, string>;
} {
    const store: Record<string, string> = { ...files };
    const calls: string[] = [];
    return {
        calls,
        store,
        readFile(path: string): Promise<string> {
            calls.push(`read:${path}`);
            const content = store[path];
            if (content === undefined) {
                const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
                err.code = 'ENOENT';
                return Promise.reject(err);
            }
            return Promise.resolve(content);
        },
        writeFile(path: string, data: string): Promise<void> {
            calls.push(`write:${path}`);
            store[path] = data;
            return Promise.resolve();
        },
        rename(from: string, to: string): Promise<void> {
            calls.push(`rename:${from}->${to}`);
            const content = store[from];
            if (content === undefined) {
                return Promise.reject(new Error(`rename source missing: ${from}`));
            }
            store[to] = content;
            delete store[from];
            return Promise.resolve();
        },
    };
}

const VALID_PROFILE = {
    localProfileId: 'alice',
    displayName: 'Alice',
    avatar: { kind: 'builtin', ref: 'avatars/red.png' },
    locale: 'en-US',
};

describe('loadDevScenario', () => {
    it('parses a valid scenario file', async () => {
        const io = makeIo({
            '/app/dev/scenarios/skirmish.json': JSON.stringify({
                gameId: 'sample',
                seats: [{ profile: 'alice.json' }, {}],
                matchSettings: { arena: 'lava-pit' },
            }),
        });

        const scenario = await loadDevScenario('/app/dev/scenarios/skirmish.json', io);

        expect(scenario.gameId).toBe('sample');
        expect(scenario.seats).toHaveLength(2);
        expect(scenario.matchSettings).toEqual({ arena: 'lava-pit' });
    });

    it('throws a DevFixtureError naming the file on malformed JSON', async () => {
        const io = makeIo({ '/app/dev/scenarios/broken.json': '{ not json' });

        await expect(loadDevScenario('/app/dev/scenarios/broken.json', io)).rejects.toThrow(
            DevFixtureError,
        );
        await expect(loadDevScenario('/app/dev/scenarios/broken.json', io)).rejects.toThrow(
            /broken\.json/,
        );
    });

    it('throws a DevFixtureError with the zod issue on a schema-invalid scenario (typo)', async () => {
        const io = makeIo({
            '/app/dev/scenarios/typo.json': JSON.stringify({ seats: [{}], autostart: true }),
        });

        await expect(loadDevScenario('/app/dev/scenarios/typo.json', io)).rejects.toThrow(
            /autostart/,
        );
    });

    it('propagates a missing file as a DevFixtureError', async () => {
        const io = makeIo();
        await expect(loadDevScenario('/app/dev/scenarios/nope.json', io)).rejects.toThrow(
            /nope\.json/,
        );
    });
});

describe('loadDevProfileFile', () => {
    it('parses a valid engine-shaped profile', async () => {
        const io = makeIo({ '/app/dev/profiles/alice.json': JSON.stringify(VALID_PROFILE) });

        const profile = await loadDevProfileFile('/app/dev/profiles/alice.json', io);

        expect(profile.localProfileId).toBe('alice');
        expect(profile.displayName).toBe('Alice');
        expect(profile.locale).toBe('en-US');
    });

    it('strips unknown game-extended fields so the profile stays wire-safe', async () => {
        const io = makeIo({
            '/app/dev/profiles/carda.json': JSON.stringify({
                ...VALID_PROFILE,
                localProfileId: 'carda',
                deck: ['strike', 'guard'],
                favouriteArena: 'lava-pit',
            }),
        });

        const profile = await loadDevProfileFile('/app/dev/profiles/carda.json', io);

        expect(profile.localProfileId).toBe('carda');
        expect('deck' in profile).toBe(false);
        expect('favouriteArena' in profile).toBe(false);
    });

    it('rejects a profile missing required engine fields (e.g. locale)', async () => {
        const { locale: _dropped, ...withoutLocale } = VALID_PROFILE;
        const io = makeIo({
            '/app/dev/profiles/bad.json': JSON.stringify(withoutLocale),
        });

        await expect(loadDevProfileFile('/app/dev/profiles/bad.json', io)).rejects.toThrow(
            DevFixtureError,
        );
        await expect(loadDevProfileFile('/app/dev/profiles/bad.json', io)).rejects.toThrow(
            /locale/,
        );
    });
});

describe('seedDevProfile', () => {
    it('saves the profile into the repository and returns its id', async () => {
        const repository = new InMemoryProfileRepository();
        const io = makeIo({ '/app/dev/profiles/alice.json': JSON.stringify(VALID_PROFILE) });

        const seededId = await seedDevProfile(repository, '/app/dev/profiles/alice.json', io);

        expect(seededId).toBe('alice');
        const stored = await repository.load(localProfileId('alice'));
        expect(stored?.displayName).toBe('Alice');
    });
});

describe('seedGeneratedDevProfile', () => {
    it('generates a distinct "Dev Player N" identity for a dev-p<N> id (no-fixture fallback)', async () => {
        const repository = new InMemoryProfileRepository();

        const seededId = await seedGeneratedDevProfile(repository, 'dev-p3');

        expect(seededId).toBe('dev-p3');
        const stored = await repository.load(localProfileId('dev-p3'));
        expect(stored?.displayName).toBe('Dev Player 3');
        expect(stored?.locale).toBe('en-US');
    });

    it('leaves an id that is not dev-p<N> alone — normal profile resolution applies', async () => {
        const repository = new InMemoryProfileRepository();

        const seededId = await seedGeneratedDevProfile(repository, 'my-custom-profile');

        expect(seededId).toBeUndefined();
        expect(await repository.load(localProfileId('my-custom-profile'))).toBeNull();
    });

    it('never overwrites an already-persisted profile with the generated one', async () => {
        const repository = new InMemoryProfileRepository();
        const io = makeIo({
            '/p.json': JSON.stringify({ ...VALID_PROFILE, localProfileId: 'dev-p2' }),
        });
        await seedDevProfile(repository, '/p.json', io);

        await seedGeneratedDevProfile(repository, 'dev-p2');

        const stored = await repository.load(localProfileId('dev-p2'));
        expect(stored?.displayName).toBe('Alice');
    });
});

describe('writeDevAnnounceFile', () => {
    it('writes atomically — a temp file first, then a rename onto the final path', async () => {
        const io = makeIo();
        const path = '/userdata/p1/dev-harness-announce.json';

        await writeDevAnnounceFile(
            path,
            { lobbyCode: '127.0.0.1:52110:tok3n', gameId: 'sample' },
            io,
        );

        expect(io.calls).toEqual([`write:${path}.tmp`, `rename:${path}.tmp->${path}`]);
        const written: unknown = JSON.parse(io.store[path]!);
        const parsed = DevAnnounceSchema.parse(written);
        expect(parsed.lobbyCode).toBe('127.0.0.1:52110:tok3n');
        expect(parsed.gameId).toBe('sample');
    });
});
