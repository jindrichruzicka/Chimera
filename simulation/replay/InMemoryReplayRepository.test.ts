/**
 * simulation/replay/InMemoryReplayRepository.test.ts
 *
 * Runs the shared ReplayRepository contract against the in-memory double, plus
 * a couple of implementation-specific checks (F44 / T3, #657).
 * Tests written first (RED before implementation).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryReplayRepository } from './InMemoryReplayRepository.js';
import {
    makeReplayFile,
    runReplayRepositoryContractTests,
} from './__test-support__/replayRepositoryContractTests.js';

runReplayRepositoryContractTests('InMemoryReplayRepository', () => new InMemoryReplayRepository());

describe('InMemoryReplayRepository — implementation details', () => {
    it('starts with no stored replays', async () => {
        const repo = new InMemoryReplayRepository();

        expect(await repo.list('any-game')).toStrictEqual([]);
    });

    it('encodes the gameId in the returned path', async () => {
        const repo = new InMemoryReplayRepository();

        const path = await repo.save(makeReplayFile('tactics'));

        expect(path).toContain('tactics');
    });
});
