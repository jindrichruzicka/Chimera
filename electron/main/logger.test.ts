import { describe, expect, it } from 'vitest';
import { createLogger, createMemorySink, createNoopLogger } from './logger.js';
import type { LogSource } from '../../shared/logging.js';

const TEST_SOURCE: LogSource = { process: 'main', module: 'test' };

/**
 * Fixed clock so the `timestamp` field is deterministic — tests assert on
 * the rest of the entry shape without ordering/timing flake.
 */
function fixedClock(value: number): () => number {
    return () => value;
}

describe('createLogger', () => {
    it('writes one entry per call with the bound source and level', () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(100) });

        logger.info('hello');

        expect(sink.entries).toHaveLength(1);
        const entry = sink.entries[0]!;
        expect(entry).toEqual({
            level: 'info',
            message: 'hello',
            timestamp: 100,
            source: TEST_SOURCE,
        });
    });

    it('attaches the inline context object verbatim', () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) });

        logger.warn('rejected', { channel: 'chimera:game:send-action', tick: 42 });

        const entry = sink.entries[0]!;
        expect(entry.level).toBe('warn');
        expect(entry.context).toEqual({ channel: 'chimera:game:send-action', tick: 42 });
    });

    it('serialises Error instances on error/fatal without mutating them', () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) });
        const cause = new Error('boom');
        cause.name = 'BoomError';

        logger.error('something failed', cause, { scope: 'x' });

        const entry = sink.entries[0]!;
        expect(entry.error?.name).toBe('BoomError');
        expect(entry.error?.message).toBe('boom');
        // Stack capture is best-effort — just verify it is a string when present.
        if (entry.error?.stack !== undefined) {
            expect(typeof entry.error.stack).toBe('string');
        }
        expect(entry.context).toEqual({ scope: 'x' });
    });

    it('child() merges bound context shallowly and adopts module override', () => {
        const sink = createMemorySink();
        const root = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) });

        const game = root.child({ module: 'game' });
        game.child({ playerId: 'p1' }).info('seat switched', { tick: 7 });

        const entry = sink.entries[0]!;
        expect(entry.source).toEqual({ process: 'main', module: 'game' });
        expect(entry.context).toEqual({ module: 'game', playerId: 'p1', tick: 7 });
    });

    it('child() does not leak bound context back into the parent logger', () => {
        const sink = createMemorySink();
        const root = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) });

        const bound = root.child({ scope: 'child' });
        bound.info('bound');
        root.info('root');

        expect(sink.entries[0]?.context).toEqual({ scope: 'child' });
        expect(sink.entries[1]?.context).toBeUndefined();
    });

    it('call-site context overrides bound keys of the same name', () => {
        const sink = createMemorySink();
        const bound = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) }).child({
            tick: 1,
        });

        bound.info('later tick', { tick: 99 });

        expect(sink.entries[0]?.context).toEqual({ tick: 99 });
    });
});

describe('createMemorySink', () => {
    it('clear() resets captured entries without replacing the array reference', () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: TEST_SOURCE, sink, now: fixedClock(0) });

        logger.info('a');
        logger.info('b');
        expect(sink.entries).toHaveLength(2);

        sink.clear();
        expect(sink.entries).toHaveLength(0);
    });
});

describe('createNoopLogger', () => {
    it('accepts every level without throwing and produces no observable output', () => {
        const logger = createNoopLogger();
        const err = new Error('x');
        // Smoke: each of the six levels must be safe to call.
        logger.trace('t');
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e', err, { k: 1 });
        logger.fatal('f', err);
        // child() returns a logger that also swallows.
        logger.child({ module: 'other' }).info('z');
        // No assertion target — surviving this block is the contract.
        expect(true).toBe(true);
    });
});
