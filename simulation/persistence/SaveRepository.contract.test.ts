/**
 * simulation/persistence/SaveRepository.contract.test.ts
 *
 * Shared SaveRepository contract test suite. Runs the same behavioural
 * tests against every SaveRepository implementation (issue #122, §4.11).
 *
 * TDD cycle: this file is written first. All tests must be RED before
 * the source files exist.
 *
 * Currently runs against InMemorySaveRepository. When FileSaveRepository
 * is implemented (T4 / #123), that implementation must pass the same suite
 * via the exported `runSaveRepositoryContractTests` helper.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports here.
 *   #41 — InMemorySaveRepository passes the identical contract suite as
 *           FileSaveRepository.
 */

import { describe, expect, it } from 'vitest';
import { InMemorySaveRepository } from './InMemorySaveRepository.js';
import { runSaveRepositoryContractTests } from './__test-support__/saveRepositoryContractTests.js';

// Run the shared contract suite against InMemorySaveRepository.
runSaveRepositoryContractTests('InMemorySaveRepository', () => new InMemorySaveRepository());

// ── InMemorySaveRepository-specific tests (not part of the shared contract) ───

describe('InMemorySaveRepository — implementation details', () => {
    it('starts with no saved slots', async () => {
        const repo = new InMemorySaveRepository();

        const slots = await repo.list('any-game');

        expect(slots).toHaveLength(0);
    });

    it('sizeBytes is a positive integer for a non-empty file', async () => {
        const repo = new InMemorySaveRepository();
        const { makeFile } = await import('./__test-support__/saveRepositoryContractTests.js');
        const file = makeFile('tactics', 'slot-1');

        await repo.save(file);
        const meta = await repo.list('tactics');

        expect(meta[0]?.sizeBytes).toBeGreaterThan(0);
        expect(Number.isInteger(meta[0]?.sizeBytes)).toBe(true);
    });

    it('sizeBytes reflects UTF-8 byte length, not character count, for non-ASCII content', async () => {
        const repo = new InMemorySaveRepository();
        const { makeFile } = await import('./__test-support__/saveRepositoryContractTests.js');
        // Build a file whose playerNames contain multi-byte UTF-8 characters.
        // Each emoji is 4 UTF-8 bytes but only 2 UTF-16 code units (surrogate pair),
        // so String.length underreports. Cyrillic chars are 2 UTF-8 bytes but 1 code unit.
        const file = {
            ...makeFile('tactics', 'slot-unicode'),
            header: {
                ...makeFile('tactics', 'slot-unicode').header,
                playerNames: ['Алиса', '🎮'],
            },
        };

        await repo.save(file);
        const meta = await repo.list('tactics');

        const reported = meta[0]?.sizeBytes ?? 0;
        const charCount = JSON.stringify(file).length;

        // UTF-8 encoding of the same JSON must be strictly larger than the
        // UTF-16 character count because of the multi-byte characters present.
        expect(reported).toBeGreaterThan(charCount);
    });
});
