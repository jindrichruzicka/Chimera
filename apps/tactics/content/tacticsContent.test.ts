/**
 * apps/tactics/content/tacticsContent.test.ts
 *
 * Unit tests for the tactics content adapter: the colour schema that validates
 * collections at load time and the pure interpreter that turns transmitted
 * generic content into the tactics palette.
 */

import { describe, expect, it } from 'vitest';
import type { GameContent } from '@chimera/simulation/foundation/game-content-contract.js';
import { ColorItemSchema } from './colorSchemas.js';
import {
    BOARD_COLORS_COLLECTION,
    PLAYER_COLORS_COLLECTION,
    TACTICS_CONTENT_SCHEMAS,
    paletteFromCollections,
} from './tacticsContent.js';

describe('ColorItemSchema', () => {
    it('accepts a well-formed colour item', () => {
        const result = ColorItemSchema.safeParse({
            id: 'blue',
            name: 'Blue',
            hex: '#2563eb',
            order: 0,
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing name', () => {
        const result = ColorItemSchema.safeParse({ id: 'blue', hex: '#2563eb', order: 0 });
        expect(result.success).toBe(false);
    });

    it('rejects a missing order', () => {
        const result = ColorItemSchema.safeParse({ id: 'blue', name: 'Blue', hex: '#2563eb' });
        expect(result.success).toBe(false);
    });

    it('rejects a negative or non-integer order', () => {
        expect(
            ColorItemSchema.safeParse({ id: 'blue', name: 'Blue', hex: '#2563eb', order: -1 })
                .success,
        ).toBe(false);
        expect(
            ColorItemSchema.safeParse({ id: 'blue', name: 'Blue', hex: '#2563eb', order: 1.5 })
                .success,
        ).toBe(false);
    });

    it('rejects a malformed hex', () => {
        expect(ColorItemSchema.safeParse({ id: 'blue', name: 'Blue', hex: 'blue' }).success).toBe(
            false,
        );
        expect(ColorItemSchema.safeParse({ id: 'blue', name: 'Blue', hex: '#25e' }).success).toBe(
            false,
        );
    });

    it('registers the schema for both colour collections', () => {
        expect(TACTICS_CONTENT_SCHEMAS[PLAYER_COLORS_COLLECTION]).toBe(ColorItemSchema);
        expect(TACTICS_CONTENT_SCHEMAS[BOARD_COLORS_COLLECTION]).toBe(ColorItemSchema);
    });
});

describe('paletteFromCollections', () => {
    const content: GameContent = {
        [PLAYER_COLORS_COLLECTION]: [
            { id: 'blue', name: 'Blue', hex: '#2563eb' },
            { id: 'amber', name: 'Amber', hex: '#f59e0b' },
        ],
        [BOARD_COLORS_COLLECTION]: [{ id: 'navy', name: 'Navy', hex: '#1e293b' }],
    };

    it('maps items to lobby options, preserving input order when no order field is present', () => {
        const palette = paletteFromCollections(content);
        expect(palette.playerColors).toEqual([
            { value: 'blue', label: 'Blue' },
            { value: 'amber', label: 'Amber' },
        ]);
        expect(palette.boardColors).toEqual([{ value: 'navy', label: 'Navy' }]);
    });

    it('orders options by the authored `order` field, not the transmitted (id-sorted) order', () => {
        // The generic content contract delivers items id-sorted (alphabetical),
        // so tactics must re-impose its own seat/display order. Items arrive
        // alphabetical (amber, blue, green, red) but author order is
        // blue→red→green→amber.
        const palette = paletteFromCollections({
            [PLAYER_COLORS_COLLECTION]: [
                { id: 'amber', name: 'Amber', hex: '#f59e0b', order: 3 },
                { id: 'blue', name: 'Blue', hex: '#2563eb', order: 0 },
                { id: 'green', name: 'Green', hex: '#16a34a', order: 2 },
                { id: 'red', name: 'Red', hex: '#dc2626', order: 1 },
            ],
        });
        expect(palette.playerColors.map((o) => o.value)).toEqual(['blue', 'red', 'green', 'amber']);
    });

    it('builds id → hex maps for both surfaces', () => {
        const palette = paletteFromCollections(content);
        expect(palette.playerColorHex).toEqual({ blue: '#2563eb', amber: '#f59e0b' });
        expect(palette.boardColorHex).toEqual({ navy: '#1e293b' });
    });

    it('falls back to the id for a label when name is missing', () => {
        const palette = paletteFromCollections({
            [PLAYER_COLORS_COLLECTION]: [{ id: 'mystery' }],
        });
        expect(palette.playerColors).toEqual([{ value: 'mystery', label: 'mystery' }]);
    });

    it('skips items without a string hex in the hex map', () => {
        const palette = paletteFromCollections({
            [PLAYER_COLORS_COLLECTION]: [{ id: 'mystery', name: 'Mystery' }],
        });
        expect(palette.playerColorHex).toEqual({});
    });

    it('tolerates missing collections (empty content)', () => {
        const palette = paletteFromCollections({});
        expect(palette.playerColors).toEqual([]);
        expect(palette.boardColors).toEqual([]);
        expect(palette.playerColorHex).toEqual({});
        expect(palette.boardColorHex).toEqual({});
    });
});
