import { describe, expect, it } from 'vitest';
import { crc32, crc32Json } from './crc32';

describe('crc32', () => {
    it('returns 0 for an empty string', () => {
        expect(crc32('')).toBe(0);
    });

    it("returns the known vector for 'hello'", () => {
        // Standard CRC32 known vector: crc32('hello') === 907060870
        expect(crc32('hello')).toBe(907060870);
    });

    it("returns the known vector for '123456789'", () => {
        // Standard CRC32 check value for '123456789' is 0xCBF43926 = 3421780262 (unsigned)
        // As a signed int32: 3421780262 - 2^32 = -873187034
        expect(crc32('123456789')).toBe(-873187034);
    });

    it('returns a different value for different inputs', () => {
        expect(crc32('hello')).not.toBe(crc32('world'));
    });

    it('is deterministic — same input always produces the same output', () => {
        const input = 'chimera-engine';
        expect(crc32(input)).toBe(crc32(input));
    });
});

describe('crc32Json', () => {
    it('delegates to crc32(JSON.stringify(value))', () => {
        const value = { action: 'MOVE', playerId: 'p1', tick: 42 };
        expect(crc32Json(value)).toBe(crc32(JSON.stringify(value)));
    });

    it('is idempotent — crc32Json(x) === crc32Json(x) for the same object', () => {
        const action = { type: 'PLACE_UNIT', unitId: 'u7', x: 3, y: 5 };
        expect(crc32Json(action)).toBe(crc32Json(action));
    });

    it('returns 0 for an empty string serialised value', () => {
        // JSON.stringify('') === '""', not '', so this should NOT be 0
        expect(crc32Json('')).not.toBe(0);
    });

    it('returns 0 for a value whose JSON serialisation is the empty string — impossible via JSON, so verifies non-zero for null', () => {
        // JSON.stringify(null) === 'null', crc32('null') !== 0
        expect(crc32Json(null)).not.toBe(0);
    });
});
