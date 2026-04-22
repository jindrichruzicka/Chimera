import { describe, expect, it } from 'vitest';
import { MalformedRefError, type DataRef, buildRef, parseRef } from './DataRef';

// ---------------------------------------------------------------------------
// DataRef<T> — Typed Cross-Collection References
// §4.8 — simulation/content/DataRef.ts
// ---------------------------------------------------------------------------

describe('buildRef', () => {
    it("produces a string with format 'collectionType:id'", () => {
        const ref = buildRef('damage-types', 'fire');
        expect(ref).toBe('damage-types:fire');
    });

    it('accepts collection types with hyphens', () => {
        const ref = buildRef('special-abilities', 'taunt');
        expect(ref).toBe('special-abilities:taunt');
    });

    it('accepts IDs with hyphens and underscores', () => {
        const ref = buildRef('units', 'heavy_knight');
        expect(ref).toBe('units:heavy_knight');
    });

    it('round-trips through parseRef', () => {
        const ref = buildRef('damage-types', 'cold');
        const parsed = parseRef(ref);
        expect(parsed.collectionType).toBe('damage-types');
        expect(parsed.id).toBe('cold');
    });

    it('throws MalformedRefError when collectionType contains a colon (M4)', () => {
        expect(() => buildRef('col:tion', 'fire')).toThrow(MalformedRefError);
    });
});

describe('parseRef', () => {
    it('returns collectionType and id for a valid ref', () => {
        const ref = buildRef('abilities', 'taunt');
        const result = parseRef(ref);
        expect(result).toEqual({ collectionType: 'abilities', id: 'taunt' });
    });

    it('handles an id that itself contains a colon (only the first colon is the separator)', () => {
        // If the id contains a colon, everything after the first colon is the id
        const ref = 'collection:part1:part2' as DataRef;
        const result = parseRef(ref);
        expect(result.collectionType).toBe('collection');
        expect(result.id).toBe('part1:part2');
    });

    it('throws MalformedRefError when the ref has no colon', () => {
        const bad = 'nodivider' as DataRef;
        expect(() => parseRef(bad)).toThrow(MalformedRefError);
    });

    it('throws MalformedRefError when the colon is the first character (empty collection type)', () => {
        const bad = ':some-id' as DataRef;
        expect(() => parseRef(bad)).toThrow(MalformedRefError);
    });

    it('throws MalformedRefError with a message that includes the malformed ref', () => {
        const bad = 'malformed' as DataRef;
        expect(() => parseRef(bad)).toThrow(/DataRef 'malformed' is malformed/);
    });
});

describe('MalformedRefError', () => {
    it('is an instance of Error', () => {
        const err = new MalformedRefError('bad-ref');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes the malformed ref on .ref', () => {
        const err = new MalformedRefError('bad-ref');
        expect(err.ref).toBe('bad-ref');
    });

    it('has a descriptive message', () => {
        const err = new MalformedRefError('nodivider');
        expect(err.message).toBe(
            "DataRef 'nodivider' is malformed — expected format: 'collection-type:item-id'",
        );
    });
});
