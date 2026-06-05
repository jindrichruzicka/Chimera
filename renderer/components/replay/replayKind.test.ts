import { describe, expect, it } from 'vitest';
import { parseReplayKind } from './replayKind';

describe('parseReplayKind', () => {
    it('parses the perspective kind', () => {
        expect(parseReplayKind('perspective')).toBe('perspective');
    });

    it('defaults to deterministic for an absent kind', () => {
        expect(parseReplayKind(null)).toBe('deterministic');
    });

    it('defaults to deterministic for an empty kind', () => {
        expect(parseReplayKind('')).toBe('deterministic');
    });

    it('passes the deterministic kind through', () => {
        expect(parseReplayKind('deterministic')).toBe('deterministic');
    });

    it('defaults to deterministic for an unrecognised kind', () => {
        expect(parseReplayKind('bogus')).toBe('deterministic');
    });
});
