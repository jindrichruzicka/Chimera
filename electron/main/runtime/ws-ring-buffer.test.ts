/**
 * electron/main/runtime/ws-ring-buffer.test.ts
 *
 * Unit tests for the O(1) ring-buffer used by the E2E WebSocket frame hook.
 *
 * Architecture: §13.9 — E2E hooks / WARN-2 performance fix.
 * Issue: #472
 */

import { describe, it, expect } from 'vitest';
import { createRingBuffer, isRingBuffer } from './ws-ring-buffer';

// ---------------------------------------------------------------------------
// createRingBuffer
// ---------------------------------------------------------------------------

describe('createRingBuffer', () => {
    it('starts empty', () => {
        const ring = createRingBuffer<number>(4);

        expect(ring.length).toBe(0);
    });

    it('returns true from Array.isArray', () => {
        const ring = createRingBuffer<number>(4);

        expect(Array.isArray(ring)).toBe(true);
    });

    it('appends elements and reflects correct length', () => {
        const ring = createRingBuffer<number>(4);

        ring.push(1);
        ring.push(2);

        expect(ring.length).toBe(2);
    });

    it('provides index access in insertion order', () => {
        const ring = createRingBuffer<string>(4);

        ring.push('a');
        ring.push('b');
        ring.push('c');

        expect(ring[0]).toBe('a');
        expect(ring[1]).toBe('b');
        expect(ring[2]).toBe('c');
    });

    it('evicts the oldest element O(1) when at capacity', () => {
        const ring = createRingBuffer<number>(3);

        ring.push(0);
        ring.push(1);
        ring.push(2);
        ring.push(3); // evicts 0

        expect(ring.length).toBe(3);
        expect(ring[0]).toBe(1); // oldest remaining
        expect(ring[1]).toBe(2);
        expect(ring[2]).toBe(3); // newest
    });

    it('keeps length at capacity after repeated overflow pushes', () => {
        const capacity = 5;
        const ring = createRingBuffer<number>(capacity);

        for (let i = 0; i < capacity + 10; i++) {
            ring.push(i);
        }

        expect(ring.length).toBe(capacity);
    });

    it('returns last capacity items in insertion order after overflow', () => {
        const capacity = 3;
        const ring = createRingBuffer<number>(capacity);

        for (let i = 0; i < 7; i++) {
            ring.push(i); // pushes 0,1,2,3,4,5,6 → keeps 4,5,6
        }

        expect(ring[0]).toBe(4);
        expect(ring[1]).toBe(5);
        expect(ring[2]).toBe(6);
    });

    it('spread gives elements in insertion order', () => {
        const ring = createRingBuffer<number>(3);
        ring.push(10);
        ring.push(20);
        ring.push(30);
        ring.push(40); // evicts 10

        expect([...ring]).toEqual([20, 30, 40]);
    });

    it('deeply equals a plain array with the same elements', () => {
        const ring = createRingBuffer<string>(4);
        ring.push('x');
        ring.push('y');

        expect(ring).toEqual(['x', 'y']);
    });

    it('toHaveLength works correctly', () => {
        const ring = createRingBuffer<number>(10);
        ring.push(1);
        ring.push(2);
        ring.push(3);

        expect(ring).toHaveLength(3);
    });

    it('index out of range returns undefined', () => {
        const ring = createRingBuffer<number>(4);
        ring.push(99);

        expect(ring[1]).toBeUndefined();
        expect(ring[-1]).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// set trap — upper-bound guard (WARN-2)
// ---------------------------------------------------------------------------

describe('set trap — upper-bound guard', () => {
    it('throws RangeError when writing to an index >= capacity', () => {
        const ring = createRingBuffer<number>(4);

        expect(() => {
            ring[99999] = 42;
        }).toThrow(RangeError);
    });

    it('throws RangeError when writing to the exact capacity boundary', () => {
        const ring = createRingBuffer<number>(4);

        expect(() => {
            ring[4] = 42; // capacity is 4, so valid indices are 0–3
        }).toThrow(RangeError);
    });

    it('does not silently grow buf beyond capacity via direct index write', () => {
        const ring = createRingBuffer<number>(4);
        ring.push(1);
        ring.push(2);

        expect(() => {
            ring[10] = 99;
        }).toThrow(RangeError);

        // Length must be unchanged
        expect(ring.length).toBe(2);
    });

    it('push() still works correctly after an attempted out-of-bounds write', () => {
        const ring = createRingBuffer<number>(4);

        try {
            ring[99999] = 42;
        } catch {
            // expected
        }

        ring.push(1);
        ring.push(2);
        expect(ring[0]).toBe(1);
        expect(ring[1]).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// isRingBuffer
// ---------------------------------------------------------------------------

describe('isRingBuffer', () => {
    it('returns true for a ring buffer', () => {
        const ring = createRingBuffer<number>(4);

        expect(isRingBuffer(ring)).toBe(true);
    });

    it('returns false for a plain array', () => {
        expect(isRingBuffer([1, 2, 3])).toBe(false);
    });

    it('returns false for an empty plain array', () => {
        expect(isRingBuffer([])).toBe(false);
    });
});
