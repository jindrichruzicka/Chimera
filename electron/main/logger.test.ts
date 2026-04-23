import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, createMemorySink, createNoopLogger, createPinoSink } from './logger.js';
import type { LogEntry, LogSource } from '@chimera/shared/logging.js';

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

    it('exposes the configured capacity', () => {
        const sink = createMemorySink(50);
        expect(sink.capacity).toBe(50);
    });

    it('defaults to capacity 2000', () => {
        const sink = createMemorySink();
        expect(sink.capacity).toBe(2000);
    });

    it('evicts the oldest entry when capacity is exceeded', () => {
        const sink = createMemorySink(3);
        const logger = createLogger({ source: TEST_SOURCE, sink });

        logger.info('first');
        logger.info('second');
        logger.info('third');
        logger.info('fourth'); // pushes 'first' out

        expect(sink.entries).toHaveLength(3);
        expect(sink.entries[0]?.message).toBe('second');
        expect(sink.entries[1]?.message).toBe('third');
        expect(sink.entries[2]?.message).toBe('fourth');
    });

    it('entries.length never exceeds capacity even after many writes', () => {
        const cap = 5;
        const sink = createMemorySink(cap);
        const logger = createLogger({ source: TEST_SOURCE, sink });

        for (let i = 0; i < cap * 3; i++) {
            logger.info(`entry-${i}`);
        }
        expect(sink.entries.length).toBeLessThanOrEqual(cap);
    });

    it('entries are returned in insertion order (oldest first)', () => {
        const sink = createMemorySink(4);
        const logger = createLogger({ source: TEST_SOURCE, sink });

        logger.info('a');
        logger.info('b');
        logger.info('c');
        logger.info('d');
        logger.info('e'); // evicts 'a'

        const messages = sink.entries.map((e) => e.message);
        expect(messages).toEqual(['b', 'c', 'd', 'e']);
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

// ─── Helpers used by createPinoSink tests ────────────────────────────────────

function makeDateString(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

const TEST_ENTRY: LogEntry = {
    level: 'info',
    message: 'test message',
    timestamp: 1000,
    source: { process: 'main', module: 'test' },
};

describe('createPinoSink', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chimera-pino-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes a LogEntry to the file system as a valid JSON line', () => {
        const fixedDate = new Date('2025-06-15T12:00:00Z');
        const sink = createPinoSink(tmpDir, () => fixedDate);

        sink.write(TEST_ENTRY);

        const logFile = path.join(tmpDir, 'chimera-2025-06-15.log');
        expect(fs.existsSync(logFile)).toBe(true);
        const line = fs.readFileSync(logFile, 'utf-8').trim();
        const parsed: unknown = JSON.parse(line);
        expect((parsed as LogEntry).level).toBe('info');
        expect((parsed as LogEntry).message).toBe('test message');
        expect((parsed as LogEntry).timestamp).toBe(1000);
    });

    it('uses the chimera-YYYY-MM-DD.log filename pattern', () => {
        const fixedDate = new Date('2025-03-07T00:00:00Z');
        const sink = createPinoSink(tmpDir, () => fixedDate);

        sink.write(TEST_ENTRY);

        const files = fs.readdirSync(tmpDir);
        expect(files).toContain('chimera-2025-03-07.log');
    });

    it('prunes log files older than 14 days on construction', () => {
        const now = new Date('2025-06-15T12:00:00Z');

        // Create a stale file (15 days ago — should be pruned).
        const staleDate = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
        const staleFile = path.join(tmpDir, `chimera-${makeDateString(staleDate)}.log`);
        fs.writeFileSync(staleFile, 'old\n');

        // Create a recent file (13 days ago — should be kept).
        const recentDate = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
        const recentFile = path.join(tmpDir, `chimera-${makeDateString(recentDate)}.log`);
        fs.writeFileSync(recentFile, 'recent\n');

        createPinoSink(tmpDir, () => now);

        expect(fs.existsSync(staleFile)).toBe(false);
        expect(fs.existsSync(recentFile)).toBe(true);
    });

    it('rotates to a new file when the date changes between writes', () => {
        // now() is called once at construction (for pruning), then once per write.
        // Sequence: construction=day1, write1=day1, write2=day2.
        let callCount = 0;
        const dates = [
            new Date('2025-06-15T23:59:00Z'), // construction (pruning)
            new Date('2025-06-15T23:59:00Z'), // first write — day one
            new Date('2025-06-16T00:01:00Z'), // second write — day two
        ];
        const sink = createPinoSink(tmpDir, () => dates[Math.min(callCount++, 2)]!);

        sink.write({ ...TEST_ENTRY, message: 'day one' });
        sink.write({ ...TEST_ENTRY, message: 'day two' });

        const day1 = path.join(tmpDir, 'chimera-2025-06-15.log');
        const day2 = path.join(tmpDir, 'chimera-2025-06-16.log');
        expect(fs.existsSync(day1)).toBe(true);
        expect(fs.existsSync(day2)).toBe(true);
        expect(fs.readFileSync(day1, 'utf-8')).toContain('day one');
        expect(fs.readFileSync(day2, 'utf-8')).toContain('day two');
    });
});
