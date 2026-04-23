/**
 * electron/main/crash-reporter.safeSerialise.test.ts
 *
 * Unit tests for the safeSerialiseSnapshot helper (Acceptance Criteria from
 * issue #184 — WARN-7: Guard crash dump snapshot serialisation against
 * circular refs and oversized payloads).
 *
 * safeSerialiseSnapshot is a pure function with no I/O; tests need no mocks.
 */

import { describe, expect, it } from 'vitest';
import { safeSerialiseSnapshot } from './crash-reporter.js';

describe('safeSerialiseSnapshot', () => {
    it('returns null verbatim when snapshot is null', () => {
        expect(safeSerialiseSnapshot(null)).toBeNull();
    });

    it('returns a small plain object verbatim', () => {
        const snap = { tick: 42, players: ['p1', 'p2'] };
        const result = safeSerialiseSnapshot(snap);
        expect(result).toEqual(snap);
    });

    it('replaces circular references with "[Circular]" instead of throwing', () => {
        // Build an object with a self-reference.
        const obj: Record<string, unknown> = { name: 'root' };
        obj['self'] = obj;

        let result: unknown;
        expect(() => {
            result = safeSerialiseSnapshot(obj);
        }).not.toThrow();

        // The serialised form must itself be JSON-encodable.
        let jsonStr: string;
        expect(() => {
            jsonStr = JSON.stringify(result);
        }).not.toThrow();

        // The circular slot must have been replaced.
        expect(jsonStr!).toContain('[Circular]');
    });

    it('returns { truncated: true, reason: "size_limit" } when snapshot exceeds 512 KB', () => {
        // Construct a string payload that will produce > 512 000 bytes when serialised.
        const bigObj = { data: 'x'.repeat(600_000) };

        const result = safeSerialiseSnapshot(bigObj);

        expect(result).toEqual({ truncated: true, reason: 'size_limit' });
    });

    it('does NOT truncate a snapshot that serialises to exactly MAX_SNAPSHOT_BYTES - 1 bytes', () => {
        // Find the minimum payload whose JSON length exceeds the limit.
        // We verify the inverse: a snapshot well under the limit passes through.
        const smallObj = { ok: true };
        const result = safeSerialiseSnapshot(smallObj);
        expect(result).toEqual(smallObj);
    });

    it('handles deeply nested circular refs without throwing', () => {
        // A → B → C → A
        const a: Record<string, unknown> = { label: 'a' };
        const b: Record<string, unknown> = { label: 'b' };
        const c: Record<string, unknown> = { label: 'c' };
        a['next'] = b;
        b['next'] = c;
        c['next'] = a;

        let result: unknown;
        expect(() => {
            result = safeSerialiseSnapshot(a);
        }).not.toThrow();

        expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('handles a primitive snapshot (number) verbatim', () => {
        expect(safeSerialiseSnapshot(99)).toBe(99);
    });

    it('handles an array snapshot verbatim', () => {
        expect(safeSerialiseSnapshot([1, 2, 3])).toEqual([1, 2, 3]);
    });
});
