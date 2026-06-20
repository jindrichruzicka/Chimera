import { describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@chimera/simulation/foundation/logging.js';
import type { LoggerSink } from './logger.js';
import { LogRingBufferSink } from './log-ring-buffer-sink.js';

function makeEntry(message: string, timestamp: number): LogEntry {
    return {
        level: 'info',
        message,
        timestamp,
        source: { process: 'main', module: 'test' },
    };
}

describe('LogRingBufferSink', () => {
    it('evicts the oldest entry when capacity is exceeded', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        const sink = new LogRingBufferSink(wrapped, 2);

        sink.write(makeEntry('first', 1));
        sink.write(makeEntry('second', 2));
        sink.write(makeEntry('third', 3));

        expect(sink.drain().map((entry) => entry.message)).toEqual(['second', 'third']);
    });

    it('returns drained entries in insertion order after wraparound', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        const sink = new LogRingBufferSink(wrapped, 3);

        sink.write(makeEntry('a', 1));
        sink.write(makeEntry('b', 2));
        sink.write(makeEntry('c', 3));
        sink.write(makeEntry('d', 4));
        sink.write(makeEntry('e', 5));

        expect(sink.drain().map((entry) => entry.message)).toEqual(['c', 'd', 'e']);
    });

    it('drain() returns entries without clearing the buffer', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        const sink = new LogRingBufferSink(wrapped, 2);

        sink.write(makeEntry('first', 1));
        const snap = sink.drain();
        sink.write(makeEntry('second', 2));

        expect(snap.map((entry) => entry.message)).toEqual(['first']);
        expect(sink.drain().map((entry) => entry.message)).toEqual(['first', 'second']);
    });

    it('delegates writes to the wrapped sink', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        const sink = new LogRingBufferSink(wrapped, 2);
        const entry = makeEntry('delegated', 1);

        sink.write(entry);

        expect(wrapped.write).toHaveBeenCalledWith(entry);
    });

    it('throws RangeError for capacity < 1', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        expect(() => new LogRingBufferSink(wrapped, 0)).toThrow(RangeError);
        expect(() => new LogRingBufferSink(wrapped, -1)).toThrow(RangeError);
    });

    it('throws RangeError for non-integer capacity', () => {
        const wrapped: LoggerSink = { write: vi.fn() };
        expect(() => new LogRingBufferSink(wrapped, 1.5)).toThrow(RangeError);
        expect(() => new LogRingBufferSink(wrapped, 2.9)).toThrow(RangeError);
    });
});
