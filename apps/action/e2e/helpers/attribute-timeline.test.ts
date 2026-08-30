import { describe, it, expect } from 'vitest';
import { valuesOf, type AttributeSample } from './attribute-timeline';

/**
 * The reader half of the recorder. The recording half is shipped into the page
 * as source text and needs a live DOM, so what is pinned here is the projection
 * a spec asserts on — which is where an interleaved stream turns into one axis's
 * history.
 */
describe('valuesOf', () => {
    const timeline: readonly AttributeSample[] = [
        { attribute: 'data-yaw', value: 'home' },
        { attribute: 'data-dolly', value: 'wide' },
        { attribute: 'data-dolly', value: 'close' },
        { attribute: 'data-yaw', value: 'away' },
    ];

    it('reads one attribute’s history, in the order the page wrote it', () => {
        expect(valuesOf(timeline, 'data-dolly')).toEqual(['wide', 'close']);
    });

    it('leaves the other axis out, however it interleaved', () => {
        // The two axes are independent, and a spec asserts an exact list per
        // axis — a filter that let the sibling through would put `wide` in the
        // middle of the yaw's history.
        expect(valuesOf(timeline, 'data-yaw')).toEqual(['home', 'away']);
    });

    it('answers an attribute the page never wrote with an empty list', () => {
        expect(valuesOf(timeline, 'data-absent')).toEqual([]);
    });
});
