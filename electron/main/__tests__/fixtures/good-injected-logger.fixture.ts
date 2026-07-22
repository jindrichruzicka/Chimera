/**
 * ESLint fixture: the Invariant #67-compliant counterpart of
 * bad-console-log.fixture.ts — the same reporting done through an injected
 * `Logger`. Must lint clean, so the smoke test proves the `no-console` zone
 * discriminates rather than flagging everything. Never imported by production
 * code.
 */
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';

export function reportSomething(logger: Logger, message: string): void {
    logger.info(message);
}
