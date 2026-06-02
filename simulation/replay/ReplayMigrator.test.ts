/**
 * simulation/replay/ReplayMigrator.test.ts
 *
 * TDD tests for the replay cross-version compatibility guard (F44 / T3, #657).
 * Tests written first (RED before implementation).
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #71 — load rejects replays whose identity triple is unknown.
 */

import { describe, expect, it } from 'vitest';
import { ReplayMigrator, ReplayVersionError } from './ReplayMigrator.js';
import type { ReplayCompatibilityTarget, ReplayMigration } from './ReplayMigrator.js';
import type { ReplayFile } from './ReplayFile.js';
import { playerId as toPlayerId } from '../engine/types.js';

function makeReplayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.1.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        gameConfig: {},
        seed: 7,
        actions: [],
        metadata: {
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 0,
            players: [{ playerId: toPlayerId('p1'), displayName: 'P1' }],
        },
        ...overrides,
    };
}

const TARGET: ReplayCompatibilityTarget = { engineVersion: '0.1.0', gameVersion: '0.1.0' };

describe('ReplayMigrator.ensureCompatible', () => {
    it('returns the file unchanged when the identity matches the target', () => {
        const migrator = new ReplayMigrator();
        const file = makeReplayFile();

        expect(migrator.ensureCompatible(file, TARGET)).toBe(file);
    });

    it('throws ReplayVersionError on an engine-version mismatch with no migrator', () => {
        const migrator = new ReplayMigrator();
        const file = makeReplayFile({ engineVersion: '0.0.9' });

        expect(() => migrator.ensureCompatible(file, TARGET)).toThrow(ReplayVersionError);
    });

    it('throws ReplayVersionError on a game-version mismatch', () => {
        const migrator = new ReplayMigrator();
        const file = makeReplayFile({ gameVersion: '0.0.1' });

        expect(() => migrator.ensureCompatible(file, TARGET)).toThrow(ReplayVersionError);
    });

    it('throws ReplayVersionError when the game is not installed (undefined target version)', () => {
        const migrator = new ReplayMigrator();
        const file = makeReplayFile();

        expect(() =>
            migrator.ensureCompatible(file, { engineVersion: '0.1.0', gameVersion: undefined }),
        ).toThrow(ReplayVersionError);
    });

    it('exposes the actual and expected identity on the thrown error', () => {
        const migrator = new ReplayMigrator();
        const file = makeReplayFile({ engineVersion: '0.0.9' });

        try {
            migrator.ensureCompatible(file, TARGET);
            expect.fail('Expected ReplayVersionError');
        } catch (err) {
            expect(err).toBeInstanceOf(ReplayVersionError);
            const verr = err as ReplayVersionError;
            expect(verr.actual.engineVersion).toBe('0.0.9');
            expect(verr.expected.engineVersion).toBe('0.1.0');
        }
    });

    it('applies a registered migration to reach a compatible identity', () => {
        const migrator = new ReplayMigrator();
        const migration: ReplayMigration = {
            from: { engineVersion: '0.0.9', gameId: 'tactics', gameVersion: '0.1.0' },
            apply: (file) => ({ ...file, engineVersion: '0.1.0' }),
        };
        migrator.register(migration);

        const file = makeReplayFile({ engineVersion: '0.0.9' });
        const result = migrator.ensureCompatible(file, TARGET);

        expect(result.engineVersion).toBe('0.1.0');
    });

    it('freezes the chain after the first ensureCompatible call', () => {
        const migrator = new ReplayMigrator();
        migrator.ensureCompatible(makeReplayFile(), TARGET);

        expect(() =>
            migrator.register({
                from: { engineVersion: 'x', gameId: 'y', gameVersion: 'z' },
                apply: (f) => f,
            }),
        ).toThrow();
    });
});
