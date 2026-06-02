import type { LogEntry } from '@chimera/shared/logging.js';
import type { LoggerSink } from './logger.js';

const DEFAULT_LOG_RING_BUFFER_CAPACITY = 1000;

export class LogRingBufferSink implements LoggerSink {
    private readonly wrapped: LoggerSink;
    private readonly buffer: (LogEntry | undefined)[];
    private head = 0;
    private size = 0;

    public constructor(wrapped: LoggerSink, capacity = DEFAULT_LOG_RING_BUFFER_CAPACITY) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError('LogRingBufferSink capacity must be a positive integer');
        }
        this.wrapped = wrapped;
        this.buffer = new Array<LogEntry | undefined>(capacity);
    }

    public write(entry: LogEntry): void {
        const slot = (this.head + this.size) % this.buffer.length;
        this.buffer[slot] = entry;
        if (this.size < this.buffer.length) {
            this.size++;
        } else {
            this.head = (this.head + 1) % this.buffer.length;
        }
        this.wrapped.write(entry);
    }

    public drain(): readonly LogEntry[] {
        const entries: LogEntry[] = [];
        for (let index = 0; index < this.size; index++) {
            const entry = this.buffer[(this.head + index) % this.buffer.length];
            if (entry !== undefined) {
                entries.push(entry);
            }
        }
        return entries;
    }
}
