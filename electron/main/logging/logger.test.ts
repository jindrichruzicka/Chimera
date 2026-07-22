import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import {
    createFanOutSink,
    createLogger,
    createMemorySink,
    createMinLevelSink,
    createNoopLogger,
    createPinoSink,
    createStderrSink,
    createStdoutSink,
    startPeriodicFlush,
} from './logger.js';
import type { LogEntry, LogSource } from '@chimera-engine/simulation/foundation/logging.js';

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
        // Flush the async SonicBoom buffer to disk before reading the file.
        sink.flushSync();

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
        // Flush the async buffer of the current (day-two) dest before reading.
        // The day-one dest was flushed synchronously on rollover.
        sink.flushSync();

        const day1 = path.join(tmpDir, 'chimera-2025-06-15.log');
        const day2 = path.join(tmpDir, 'chimera-2025-06-16.log');
        expect(fs.existsSync(day1)).toBe(true);
        expect(fs.existsSync(day2)).toBe(true);
        expect(fs.readFileSync(day1, 'utf-8')).toContain('day one');
        expect(fs.readFileSync(day2, 'utf-8')).toContain('day two');
    });

    it('calls flushSync() then end() on the previous SonicBoom before opening a new destination on rollover', () => {
        const capturedInstances: ReturnType<typeof pino.destination>[] = [];
        const realDest = pino.destination.bind(pino);
        const intercepted = vi
            .spyOn(pino, 'destination')
            .mockImplementation((...args: Parameters<typeof pino.destination>) => {
                const inst = realDest(...args);
                capturedInstances.push(inst);
                return inst;
            });

        let callCount = 0;
        const dates = [
            new Date('2025-06-15T23:59:00Z'),
            new Date('2025-06-15T23:59:00Z'),
            new Date('2025-06-16T00:01:00Z'),
        ];
        const sink = createPinoSink(tmpDir, () => dates[Math.min(callCount++, 2)]!);

        sink.write({ ...TEST_ENTRY, message: 'day one' });
        // After the first write, capturedInstances[0] is the first SonicBoom.
        // Spy on its flushSync and end so we can assert they are called on rollover.
        const firstDest = capturedInstances[0]!;
        const flushSyncSpy = vi.spyOn(firstDest, 'flushSync');
        const endSpy = vi.spyOn(firstDest, 'end');

        sink.write({ ...TEST_ENTRY, message: 'day two' }); // triggers rollover

        expect(flushSyncSpy).toHaveBeenCalledOnce();
        expect(endSpy).toHaveBeenCalledOnce();
        expect(capturedInstances).toHaveLength(2); // two destinations opened

        intercepted.mockRestore();
    });

    it('entries written before rollover appear in the old file and entries after in the new file', () => {
        let callCount = 0;
        const dates = [
            new Date('2025-06-20T23:59:00Z'),
            new Date('2025-06-20T23:59:00Z'),
            new Date('2025-06-21T00:01:00Z'),
            new Date('2025-06-21T00:02:00Z'),
        ];
        const sink = createPinoSink(tmpDir, () => dates[Math.min(callCount++, 3)]!);

        sink.write({ ...TEST_ENTRY, message: 'before-rollover' });
        sink.write({ ...TEST_ENTRY, message: 'after-rollover-1' });
        sink.write({ ...TEST_ENTRY, message: 'after-rollover-2' });
        // Flush the async buffer of the current (day-21) dest before reading.
        // The day-20 dest was flushed synchronously on rollover.
        sink.flushSync();

        const oldFile = path.join(tmpDir, 'chimera-2025-06-20.log');
        const newFile = path.join(tmpDir, 'chimera-2025-06-21.log');
        const oldContent = fs.readFileSync(oldFile, 'utf-8');
        const newContent = fs.readFileSync(newFile, 'utf-8');

        expect(oldContent).toContain('before-rollover');
        expect(oldContent).not.toContain('after-rollover');
        expect(newContent).toContain('after-rollover-1');
        expect(newContent).toContain('after-rollover-2');
        expect(newContent).not.toContain('before-rollover');
    });

    it('createPinoSink returns a FlushableSink with a callable flushSync() method', () => {
        const fixedDate = new Date('2025-06-15T12:00:00Z');
        const sink = createPinoSink(tmpDir, () => fixedDate);

        // FlushableSink contract: must have a flushSync method
        expect(typeof (sink as { flushSync?: unknown }).flushSync).toBe('function');

        // Write an entry so dest is initialised, then flushing should not throw
        sink.write(TEST_ENTRY);
        expect(() => (sink as { flushSync(): void }).flushSync()).not.toThrow();
    });

    it('pino.destination is not called with sync: true (async writes for main-loop health)', () => {
        const capturedOpts: Parameters<typeof pino.destination>[] = [];
        const realDestination = pino.destination.bind(pino);
        const intercepted = vi
            .spyOn(pino, 'destination')
            .mockImplementation((...args: Parameters<typeof pino.destination>) => {
                capturedOpts.push(args);
                return realDestination(...args);
            });

        const fixedDate = new Date('2025-07-01T00:00:00Z');
        const sink = createPinoSink(tmpDir, () => fixedDate);
        sink.write(TEST_ENTRY);

        // There must be at least one pino.destination call and none of them
        // may use sync: true (which blocks the event loop on every write).
        expect(capturedOpts.length).toBeGreaterThanOrEqual(1);
        for (const [opts] of capturedOpts) {
            expect((opts as { sync?: boolean } | undefined)?.sync).not.toBe(true);
        }

        intercepted.mockRestore();
    });
});

describe('createStdoutSink', () => {
    const entry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
        level: 'info',
        message: 'dev harness: auto-hosting',
        timestamp: 1000,
        source: { process: 'main', module: 'dev-harness' },
        ...overrides,
    });

    it('renders one line per entry: level, module, message', () => {
        const lines: string[] = [];
        const sink = createStdoutSink((line) => lines.push(line));

        sink.write(entry());

        expect(lines).toHaveLength(1);
        expect(lines[0]).toBe('info  [dev-harness] dev harness: auto-hosting\n');
    });

    it('appends the context as compact JSON when present', () => {
        const lines: string[] = [];
        const sink = createStdoutSink((line) => lines.push(line));

        sink.write(entry({ context: { gameId: 'sample', maxPlayers: 2 } }));

        expect(lines[0]).toBe(
            'info  [dev-harness] dev harness: auto-hosting {"gameId":"sample","maxPlayers":2}\n',
        );
    });

    it('appends the error message for error entries', () => {
        const lines: string[] = [];
        const sink = createStdoutSink((line) => lines.push(line));

        sink.write(
            entry({
                level: 'error',
                message: 'dev harness bootstrap failed',
                error: { name: 'Error', message: 'scenario gameId mismatch' },
            }),
        );

        expect(lines[0]).toContain('error [dev-harness] dev harness bootstrap failed');
        expect(lines[0]).toContain('scenario gameId mismatch');
    });

    it('swallows a throwing writer', () => {
        // Every refusal in main() logs through the fan-out sink and then calls
        // app.exit(1) (see `refuseToStart`). A console mirror that threw — EPIPE
        // once the parent closed the pipe — would propagate out of
        // `logger.error`, skip the exit, and leave the windowless process the
        // refusal exists to prevent. The file sink is the record; this echo is
        // best-effort.
        const sink = createStdoutSink(() => {
            throw new Error('EPIPE');
        });

        expect(() => sink.write(entry())).not.toThrow();
    });
});

describe('createStderrSink', () => {
    const entry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
        level: 'fatal',
        message: 'refusing to start — game settings registration failed',
        timestamp: 1000,
        source: { process: 'main', module: 'root' },
        ...overrides,
    });

    it('renders the same line shape as the stdout sink, through the injected writer', () => {
        const lines: string[] = [];
        const sink = createStderrSink((line) => lines.push(line));

        sink.write(entry({ error: { name: 'SettingsNamespaceCollisionError', message: 'audio' } }));

        expect(lines).toHaveLength(1);
        expect(lines[0]).toBe(
            'fatal [root] refusing to start — game settings registration failed — audio\n',
        );
    });

    it('writes to process.stderr by default', () => {
        // The point of this sink: the terminal a dev launch was started from.
        // stdout would be the wrong stream, and is already taken by the dev
        // harness sink, whose orchestrator prefixes and relays it.
        const written = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            createStderrSink().write(entry({ message: 'boom' }));

            expect(written).toHaveBeenCalledWith('fatal [root] boom\n');
        } finally {
            written.mockRestore();
        }
    });

    it('swallows a throwing writer', () => {
        const sink = createStderrSink(() => {
            throw new Error('EPIPE');
        });

        expect(() => sink.write(entry())).not.toThrow();
    });

    it('swallows an entry it cannot format', () => {
        // Formatting is inside the guard too, not only the write: the context is
        // rendered with JSON.stringify, which throws on a circular reference. The
        // console sinks are an echo, so an unrenderable entry must be dropped
        // rather than raised at `logger.error` — which in a refusal path sits
        // directly above `app.exit(1)`.
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        const lines: string[] = [];
        const sink = createStderrSink((line) => lines.push(line));

        expect(() => sink.write(entry({ context: circular }))).not.toThrow();
        expect(lines).toHaveLength(0);
    });
});

describe('createFanOutSink', () => {
    const entry = (message = 'an entry'): LogEntry => ({
        level: 'error',
        message,
        timestamp: 1000,
        source: { process: 'main', module: 'root' },
    });

    const isNotice = (e: LogEntry): boolean => e.message.startsWith('log sink');

    it('writes to every sink, in declaration order, and skips absent ones', () => {
        const order: string[] = [];
        const sink = createFanOutSink({
            a: { write: () => order.push('a') },
            absent: null,
            b: { write: () => order.push('b') },
            unset: undefined,
        });

        sink.write(entry());

        expect(order).toEqual(['a', 'b']);
    });

    it('isolates the legs: a throwing sink does not deny the others or the caller', () => {
        // The regression this exists for: the Pino file sink is written FIRST and
        // `createPinoSink.write` opens a file descriptor, so a rollover or a
        // destroyed SonicBoom can throw. Unisolated, that swallowed the memory
        // sink and whichever console mirror was wired with it — so a fatal refusal exited 1
        // with nothing in the log file AND nothing on the terminal, the exact
        // silence the refusal reporting exists to prevent.
        const seen: string[] = [];
        const sink = createFanOutSink({
            file: {
                write: () => {
                    throw new Error('EBADF');
                },
            },
            memory: { write: (e) => seen.push(e.message) },
            mirror: { write: (e) => seen.push(`mirror:${e.message}`) },
        });

        expect(() => sink.write(entry('refusal'))).not.toThrow();
        // Both survivors get the entry itself (they also get one notice about
        // the dead leg — asserted below, filtered out here).
        expect(seen.filter((m) => !m.includes('log sink'))).toEqual(['refusal', 'mirror:refusal']);
    });

    it('reports a failed leg on the surviving legs instead of dropping it silently', () => {
        // Isolation alone makes a broken transport INVISIBLE: the Pino file sink
        // is the durable record, and in production nothing else calls it, so a
        // permanently failing fd would leave the log file empty with no signal
        // on any channel. The surviving legs are the only place left to say so.
        const seen: LogEntry[] = [];
        const sink = createFanOutSink({
            file: {
                write: () => {
                    throw new Error('EBADF');
                },
            },
            memory: { write: (e) => void seen.push(e) },
        });

        sink.write(entry('refusal'));

        expect(seen).toHaveLength(2);
        // The provoking entry first: a leg's own delivery must not be delayed by
        // another leg's failure, and the notice reads as following what caused it.
        expect(seen[0]!.message).toBe('refusal');
        const notice = seen[1]!;
        expect(notice.level).toBe('error');
        // Named, not positional: the index into the surviving-leg array means a
        // different transport in a packaged build than under `dev:mp`.
        expect(notice.message).toContain('log sink "file"');
        expect(notice.error?.message).toBe('EBADF');
    });

    it('reports an uninterrupted run of failures once, not once per entry', () => {
        // A leg that fails on every write (a closed fd) must not turn the
        // surviving legs into a firehose of identical notices — the signal is
        // "this transport is broken", and it is worth exactly one line.
        const seen: LogEntry[] = [];
        const sink = createFanOutSink({
            file: {
                write: () => {
                    throw new Error('EBADF');
                },
            },
            stdout: {
                write: () => {
                    throw new Error('EPIPE');
                },
            },
            memory: { write: (e) => void seen.push(e) },
        });

        sink.write(entry('one'));
        sink.write(entry('two'));

        expect(seen.filter(isNotice)).toHaveLength(2);
        expect(seen.filter((e) => !isNotice(e)).map((e) => e.message)).toEqual(['one', 'two']);
    });

    it('reports a leg again after it recovers and fails a second time', () => {
        // The latch is per RUN of failures, not per leg for the session. A leg
        // has two unrelated failure modes — `createPinoSink.write` throws on a
        // dead fd (permanent) AND on an entry it cannot serialise (transient,
        // one bad `context`). Latching for the session on the transient one
        // would spend the leg's only announcement on a sink that is still
        // working, and then swallow the genuine EBADF that follows.
        const seen: LogEntry[] = [];
        let failing = true;
        const sink = createFanOutSink({
            file: {
                write: () => {
                    if (failing) {
                        throw new Error('unserialisable context');
                    }
                },
            },
            memory: { write: (e) => void seen.push(e) },
        });

        sink.write(entry('bad context')); // announced
        failing = false;
        sink.write(entry('healthy again')); // clears the latch
        failing = true;
        sink.write(entry('genuinely dead')); // must be announced again

        const notices = seen.filter(isNotice);
        expect(notices).toHaveLength(2);
        expect(notices[1]!.error?.message).toBe('unserialisable context');
    });

    it('never lets the notice itself throw, or re-notify about the notice', () => {
        // Both legs broken: the notice for the first is attempted on the second,
        // which also throws. That must not escape, and must not recurse.
        const sink = createFanOutSink({
            first: {
                write: () => {
                    throw new Error('first down');
                },
            },
            second: {
                write: () => {
                    throw new Error('second down');
                },
            },
        });

        expect(() => sink.write(entry('refusal'))).not.toThrow();
    });
});

describe('createMinLevelSink', () => {
    const entry = (level: LogEntry['level']): LogEntry => ({
        level,
        message: `a ${level} entry`,
        timestamp: 1000,
        source: { process: 'main', module: 'root' },
    });

    it('drops entries below the threshold and forwards the rest unchanged', () => {
        const seen: LogEntry[] = [];
        const sink = createMinLevelSink('error', { write: (e) => void seen.push(e) });

        for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
            sink.write(entry(level));
        }

        expect(seen.map((e) => e.level)).toEqual(['error', 'fatal']);
        expect(seen[0]).toStrictEqual(entry('error'));
    });

    it('forwards everything at the lowest threshold', () => {
        const seen: LogEntry[] = [];
        const sink = createMinLevelSink('trace', { write: (e) => void seen.push(e) });

        sink.write(entry('trace'));
        sink.write(entry('fatal'));

        expect(seen).toHaveLength(2);
    });
});

describe('startPeriodicFlush', () => {
    it('flushes the sink on every interval tick until disposed', () => {
        vi.useFakeTimers();
        try {
            let flushes = 0;
            const dispose = startPeriodicFlush({ flushSync: () => void (flushes += 1) }, 500);

            vi.advanceTimersByTime(1600);
            expect(flushes).toBe(3);

            dispose();
            vi.advanceTimersByTime(2000);
            expect(flushes).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps ticking if a flush throws (a transient fs error must not kill the timer)', () => {
        vi.useFakeTimers();
        try {
            let calls = 0;
            const dispose = startPeriodicFlush(
                {
                    flushSync: () => {
                        calls += 1;
                        if (calls === 1) throw new Error('EBADF');
                    },
                },
                500,
            );

            vi.advanceTimersByTime(1100);
            expect(calls).toBe(2);
            dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});
