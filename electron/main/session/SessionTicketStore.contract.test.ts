/**
 * electron/main/session/SessionTicketStore.contract.test.ts
 *
 * Runs the shared SessionTicketStore contract suite against the in-memory
 * implementation (invariant #41 — the in-memory twin must be behaviourally
 * identical to FileSessionTicketStore, which runs the same suite in
 * FileSessionTicketStore.test.ts).
 */

import { runSessionTicketStoreContractTests } from './__test-support__/sessionTicketStoreContractTests.js';
import { InMemorySessionTicketStore } from './InMemorySessionTicketStore.js';

runSessionTicketStoreContractTests(
    'InMemorySessionTicketStore',
    () => new InMemorySessionTicketStore(),
);
