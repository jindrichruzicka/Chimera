/**
 * simulation/replay/InMemoryPerspectiveReplayRepository.test.ts
 *
 * Runs the shared PerspectiveReplayRepository contract suite against the
 * in-memory double (§4.28, ADR F44b, invariant #41). Tests written first
 * (RED before implementation).
 */

import { runPerspectiveReplayRepositoryContractTests } from './__test-support__/perspectiveReplayRepositoryContractTests.js';
import { InMemoryPerspectiveReplayRepository } from './InMemoryPerspectiveReplayRepository.js';

runPerspectiveReplayRepositoryContractTests(
    'InMemoryPerspectiveReplayRepository',
    () => new InMemoryPerspectiveReplayRepository(),
);
