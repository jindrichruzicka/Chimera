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

    it("returns the correct value for a 2-byte UTF-8 sequence ('café' — U+00E9 é)", () => {
        // 'é' encodes as 0xC3 0xA9 in UTF-8 (2 bytes)
        // Expected value verified via Node.js TextEncoder + CRC32 reference implementation
        expect(crc32('café')).toBe(-1733475659);
    });

    it("returns the correct value for a 4-byte UTF-8 sequence ('🎮' — U+1F3AE)", () => {
        // '🎮' encodes as 0xF0 0x9F 0x8E 0xAE in UTF-8 (4 bytes, surrogate pair in JS)
        // Expected value verified via Node.js TextEncoder + CRC32 reference implementation
        expect(crc32('🎮')).toBe(-989655716);
    });

    it('correctly handles a string mixing ASCII and multi-byte UTF-8 code points', () => {
        // 'hello 🌍' — ASCII + 4-byte globe emoji (U+1F30D)
        // Expected value verified via Node.js TextEncoder + CRC32 reference implementation
        expect(crc32('hello 🌍')).toBe(-1335285689);
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

    it('returns non-zero for null (JSON.stringify(null) === "null")', () => {
        // JSON.stringify(null) === 'null', crc32('null') !== 0
        expect(crc32Json(null)).not.toBe(0);
    });

    it('throws TypeError when passed undefined (non-serializable)', () => {
        // JSON.stringify(undefined) returns JS undefined, not a string — must throw, not silently produce a wrong checksum
        expect(() => crc32Json(undefined)).toThrow(TypeError);
    });

    it('throws TypeError when passed a Symbol (non-serializable)', () => {
        expect(() => crc32Json(Symbol('test'))).toThrow(TypeError);
    });

    it('throws TypeError when passed a function (non-serializable)', () => {
        expect(() => crc32Json(() => 42)).toThrow(TypeError);
    });

    it('throws TypeError when passed a bigint (JSON.stringify throws internally)', () => {
        // BigInt causes JSON.stringify to throw its own TypeError before returning undefined.
        // crc32Json must normalise that into a uniform TypeError with a predictable message.
        expect(() => crc32Json(BigInt(42))).toThrow(TypeError);
        expect(() => crc32Json(BigInt(42))).toThrow('crc32Json: value is not JSON-serialisable');
    });
});
