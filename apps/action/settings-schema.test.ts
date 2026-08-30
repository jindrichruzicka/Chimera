import { describe, expect, it } from 'vitest';
import { ENGINE_DEFAULTS } from '@chimera-engine/simulation/settings/index.js';

import { ACTION_GAME_ID } from './simulation/constants.js';
import { ACTION_ALL_MOVE_ACTION_IDS, ACTION_DEFAULT_MOVE_BINDINGS } from './input-action-ids.js';
import { ACTION_DEFAULTS, actionSettingsSchema } from './settings-schema.js';

describe('actionSettingsSchema', () => {
    it('registers under the action game id', () => {
        expect(actionSettingsSchema.gameId).toBe(ACTION_GAME_ID);
    });

    it('carries every reserved engine namespace intact', () => {
        // `SettingsManager.registerSchema` rejects a schema that shadows or
        // drops one of the four reserved namespaces (Invariant #35).
        const defaults = actionSettingsSchema.defaults;
        expect(defaults.audio).toEqual(ENGINE_DEFAULTS.audio);
        expect(defaults.display).toEqual(ENGINE_DEFAULTS.display);
        expect(defaults.gameplay).toEqual(ENGINE_DEFAULTS.gameplay);
        expect(defaults.controls.bindings).toBeDefined();
    });

    it('exports ACTION_DEFAULTS matching the schema defaults', () => {
        expect(ACTION_DEFAULTS).toEqual(actionSettingsSchema.defaults);
    });

    it("adds BOTH seats' movement bindings on top of the engine ones", () => {
        // Both clusters, not seat one's: the pass-and-play seat arrives bound
        // or it is a seat nobody can move on a fresh install, and the seat-one
        // list would iterate clean either way.
        const bindings = actionSettingsSchema.defaults.controls.bindings;

        for (const id of ACTION_ALL_MOVE_ACTION_IDS) {
            expect(bindings[id], id).toEqual(ACTION_DEFAULT_MOVE_BINDINGS[id]);
        }
    });

    it('carries every binding the id table declares, and invents none', () => {
        // The count, as a set difference rather than a number: a game id in the
        // defaults that the table does not declare is a row the rebind pane
        // lists for an action nothing dispatches.
        const bindings = actionSettingsSchema.defaults.controls.bindings;
        const gameIds = Object.keys(bindings).filter((id) => id.startsWith('game:'));

        expect(gameIds.sort()).toEqual([...ACTION_ALL_MOVE_ACTION_IDS].sort());
    });

    it('keeps every engine binding it did not author', () => {
        // Spreading the game bindings over a fresh object rather than over the
        // engine's would silently drop Escape, undo and the perf-HUD toggle.
        const bindings = actionSettingsSchema.defaults.controls.bindings;

        for (const [id, binding] of Object.entries(ENGINE_DEFAULTS.controls.bindings)) {
            expect(bindings[id], id).toEqual(binding);
        }
    });

    it('adds no settings field beyond the engine ones', () => {
        // The action app is a movement sandbox; it has nothing to configure yet,
        // and an unread field in the settings page is a promise it cannot keep.
        expect(Object.keys(actionSettingsSchema.defaults).sort()).toEqual(
            Object.keys(ENGINE_DEFAULTS).sort(),
        );
    });

    it('parses its own defaults', () => {
        expect(actionSettingsSchema.schema.parse(ACTION_DEFAULTS)).toEqual(ACTION_DEFAULTS);
    });

    it('rejects a malformed engine field', () => {
        // Positive control on the Zod shape: without it, a schema of `z.any()`
        // would pass every assertion above.
        expect(() =>
            actionSettingsSchema.schema.parse({
                ...ACTION_DEFAULTS,
                display: { targetFps: 'fast' },
            }),
        ).toThrow();
    });
});
