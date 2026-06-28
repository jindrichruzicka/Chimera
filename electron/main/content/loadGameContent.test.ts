/**
 * electron/main/content/loadGameContent.test.ts
 *
 * Round-trip test for the startup content loader against the real apps/ tree,
 * plus the plain-collection flattener. Exercises the game-supplied schemas
 * (a malformed colour would fail the load — Invariant #14).
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    paletteFromCollections,
    TACTICS_CONTENT_SCHEMAS,
} from '@chimera-engine/tactics/content/tacticsContent.js';
import { loadAllGameContent, toGameContent } from './loadGameContent.js';

// Repo `apps/` dir: electron/main/content → up 3 → repo root → apps (game apps
// relocated from games/ in F63 #782).
const APPS_ROOT = path.resolve(__dirname, '../../..', 'apps');

// The per-game schema map the host derives from the injected contributions and
// hands to the loader (formerly the static gameContentRegistry; F64-prep #788).
const TACTICS_SCHEMAS = { tactics: TACTICS_CONTENT_SCHEMAS };

describe('loadAllGameContent', () => {
    it('loads tactics player-colors and board-colors from the real data dir', async () => {
        const dbs = await loadAllGameContent(APPS_ROOT, TACTICS_SCHEMAS);
        const tactics = dbs.get('tactics');
        expect(tactics).toBeDefined();
        expect([...(tactics?.getAllIds('player-colors') ?? [])].sort()).toEqual([
            'amber',
            'blue',
            'green',
            'red',
        ]);
        expect([...(tactics?.getAllIds('board-colors') ?? [])].sort()).toEqual([
            'navy',
            'slate',
            'stone',
        ]);
    });

    it('loads no database for a game whose schemas are not injected (Invariant #46)', async () => {
        const dbs = await loadAllGameContent(APPS_ROOT, {});
        expect(dbs.size).toBe(0);
        expect(dbs.get('tactics')).toBeUndefined();
    });
});

describe('toGameContent', () => {
    it('flattens a loaded database into plain collections with all item fields', async () => {
        const dbs = await loadAllGameContent(APPS_ROOT, TACTICS_SCHEMAS);
        const tactics = dbs.get('tactics');
        expect(tactics).toBeDefined();
        const content = toGameContent(tactics!);

        expect(content['player-colors']).toContainEqual({
            id: 'blue',
            name: 'Blue',
            hex: '#2563eb',
            order: 0,
        });
        expect(content['board-colors']).toContainEqual({
            id: 'slate',
            name: 'Slate',
            hex: '#3f3f46',
            order: 0,
        });
    });

    // Guards the colour-ordering regression: the generic content pipeline
    // delivers items id-sorted (amber, blue, …), so the tactics interpreter must
    // re-impose the authored seat/display order. Default seat assignment maps
    // seat n → playerColors[n], so a wrong order silently mis-colours units (e.g.
    // the host's "own" unit rendering amber instead of blue).
    it('interprets the real data into the authored player/board colour order', async () => {
        const dbs = await loadAllGameContent(APPS_ROOT, TACTICS_SCHEMAS);
        const tactics = dbs.get('tactics');
        expect(tactics).toBeDefined();

        const palette = paletteFromCollections(toGameContent(tactics!));
        expect(palette.playerColors.map((o) => o.value)).toEqual(['blue', 'red', 'green', 'amber']);
        expect(palette.boardColors.map((o) => o.value)).toEqual(['slate', 'stone', 'navy']);
    });
});
