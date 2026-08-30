import { describe, expect, it } from 'vitest';

import { ACTION_DEFAULT_MOVE_BINDINGS, ACTION_MOVE_ACTION_IDS } from '../input-action-ids.js';
import { ACTION_INPUT_ACTIONS } from './input-actions.js';

describe('ACTION_INPUT_ACTIONS', () => {
    it('declares exactly the movement actions the app names elsewhere', () => {
        // The table and the default bindings are two lists of the same ids; a
        // row missing here is an action the Controls panel never lists, and a
        // row missing there is one that arrives unbound.
        expect(ACTION_INPUT_ACTIONS.map((action) => action.id)).toEqual([
            ...ACTION_MOVE_ACTION_IDS,
        ]);
        expect(Object.keys(ACTION_DEFAULT_MOVE_BINDINGS).sort()).toEqual(
            ACTION_INPUT_ACTIONS.map((action) => action.id).sort(),
        );
    });

    it('gives every row a description and groups them under one category', () => {
        for (const action of ACTION_INPUT_ACTIONS) {
            expect(action.description, action.id).not.toBe('');
        }
        expect(new Set(ACTION_INPUT_ACTIONS.map((action) => action.category)).size).toBe(1);
    });

    it('describes each row distinctly', () => {
        // Four identical labels in the rebind panel would be unrebindable in
        // practice — the player could not tell which row is which.
        const descriptions = ACTION_INPUT_ACTIONS.map((action) => action.description);
        expect(new Set(descriptions).size).toBe(descriptions.length);
    });

    it('marks every movement action oneShot, so OS key-repeat is dropped', () => {
        // `oneShot` does not suppress the key-UP event — both edges dispatch
        // regardless. What it suppresses is the auto-repeat press storm while a
        // key is held, which would re-derive the same velocity many times a
        // second.
        for (const action of ACTION_INPUT_ACTIONS) {
            expect(action.oneShot, action.id).toBe(true);
        }
    });
});
