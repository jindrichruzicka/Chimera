import { describe, expect, it } from 'vitest';

import { MalformedAssetRefError, isTraversalUnsafe, parseAssetRef } from './asset-ref-parse';

// ---------------------------------------------------------------------------
// shared/asset-ref-parse.ts — §4.10 co-located unit tests
// ---------------------------------------------------------------------------

describe('isTraversalUnsafe', () => {
    it('returns false for a valid gameId and relativePath', () => {
        expect(isTraversalUnsafe('tactics', 'textures/units/warrior.webp')).toBe(false);
    });

    it('returns true when gameId is empty', () => {
        expect(isTraversalUnsafe('', 'textures/grass.webp')).toBe(true);
    });

    it('returns true when gameId contains a slash', () => {
        expect(isTraversalUnsafe('tac/tics', 'textures/grass.webp')).toBe(true);
    });

    it('returns true when gameId contains a NUL byte', () => {
        expect(isTraversalUnsafe('tac\0tics', 'textures/grass.webp')).toBe(true);
    });

    it('returns true when gameId is ".."', () => {
        expect(isTraversalUnsafe('..', 'textures/grass.webp')).toBe(true);
    });

    it('returns true when gameId is "."', () => {
        expect(isTraversalUnsafe('.', 'textures/grass.webp')).toBe(true);
    });

    it('returns true when relativePath starts with /', () => {
        expect(isTraversalUnsafe('tactics', '/absolute/path.png')).toBe(true);
    });

    it('returns true when relativePath contains a NUL byte', () => {
        expect(isTraversalUnsafe('tactics', 'ok\0evil')).toBe(true);
    });

    it('returns true when relativePath contains ".." as a standalone segment', () => {
        expect(isTraversalUnsafe('tactics', '../etc/shadow')).toBe(true);
    });

    it('returns true when relativePath has ".." in a nested segment', () => {
        expect(isTraversalUnsafe('tactics', 'textures/../../etc/shadow')).toBe(true);
    });

    it('returns false when a segment merely contains ".." as a substring (not standalone)', () => {
        // "..webp" is not a traversal component
        expect(isTraversalUnsafe('tactics', 'textures/..webp')).toBe(false);
    });

    it('returns true when relativePath is empty', () => {
        expect(isTraversalUnsafe('tactics', '')).toBe(true);
    });
});

describe('parseAssetRef', () => {
    it('returns gameId and relativePath for a valid ref', () => {
        const result = parseAssetRef('tactics/textures/units/warrior.webp');
        expect(result).toEqual({
            gameId: 'tactics',
            relativePath: 'textures/units/warrior.webp',
        });
    });

    it('handles relative paths with more than one internal slash', () => {
        const result = parseAssetRef('tactics/audio/sfx/sword-hit.ogg');
        expect(result.gameId).toBe('tactics');
        expect(result.relativePath).toBe('audio/sfx/sword-hit.ogg');
    });

    it('throws MalformedAssetRefError when no slash is present', () => {
        expect(() => parseAssetRef('noslash')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when the slash is the first character (empty gameId)', () => {
        expect(() => parseAssetRef('/some/path.webp')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId is ".."', () => {
        expect(() => parseAssetRef('../textures/grass.webp')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when gameId is "."', () => {
        expect(() => parseAssetRef('./textures/grass.webp')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when relativePath contains ".."', () => {
        expect(() => parseAssetRef('tactics/../etc/shadow')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError when relativePath starts with /', () => {
        expect(() => parseAssetRef('tactics//absolute')).toThrow(MalformedAssetRefError);
    });

    it('throws MalformedAssetRefError with the correct message format', () => {
        expect(() => parseAssetRef('noslash')).toThrow(
            /AssetRef 'noslash' is malformed — expected format: 'game-id\/relative\/path\.ext'/,
        );
    });

    it('throws MalformedAssetRefError when relativePath is empty (trailing slash only)', () => {
        expect(() => parseAssetRef('tactics/')).toThrow(MalformedAssetRefError);
    });
});

describe('MalformedAssetRefError', () => {
    it('is an instance of Error', () => {
        const err = new MalformedAssetRefError('bad-ref');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes the malformed ref on .ref', () => {
        const err = new MalformedAssetRefError('bad-ref');
        expect(err.ref).toBe('bad-ref');
    });

    it('has the exact descriptive message specified in §4.10', () => {
        const err = new MalformedAssetRefError('noslash');
        expect(err.message).toBe(
            "AssetRef 'noslash' is malformed — expected format: 'game-id/relative/path.ext'",
        );
    });

    it('name is "MalformedAssetRefError"', () => {
        const err = new MalformedAssetRefError('bad');
        expect(err.name).toBe('MalformedAssetRefError');
    });

    it('maintains correct prototype chain (instanceof works after transpilation)', () => {
        const err = new MalformedAssetRefError('bad');
        expect(err instanceof MalformedAssetRefError).toBe(true);
    });
});
