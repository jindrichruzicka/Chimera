import { describe, expect, it } from 'vitest';

import {
    ACTION_ALL_MOVE_ACTION_IDS,
    ACTION_DEFAULT_MOVE_BINDINGS,
    ACTION_MOVE_ACTION_IDS,
    ACTION_P2_MOVE_ACTION_IDS,
} from '../input-action-ids.js';
import { ACTION_INPUT_ACTIONS } from './input-actions.js';

describe('ACTION_INPUT_ACTIONS', () => {
    it('declares exactly the movement actions the app names elsewhere, both seats', () => {
        // The table and the default bindings are two lists of the same ids; a
        // row missing here is an action the Controls panel never lists, and a
        // row missing there is one that arrives unbound.
        expect(ACTION_INPUT_ACTIONS.map((action) => action.id)).toEqual([
            ...ACTION_ALL_MOVE_ACTION_IDS,
        ]);
        expect(Object.keys(ACTION_DEFAULT_MOVE_BINDINGS).sort()).toEqual(
            ACTION_INPUT_ACTIONS.map((action) => action.id).sort(),
        );
    });

    it('gives every row a description', () => {
        for (const action of ACTION_INPUT_ACTIONS) {
            expect(action.description, action.id).not.toBe('');
        }
    });

    it('groups the two seats under two distinct categories', () => {
        // Interleaving eight rows under one heading makes the rebind panel a
        // wall; the grouping is what keeps a seat's keys together.
        const categoryOf = (id: string): string | undefined =>
            ACTION_INPUT_ACTIONS.find((action) => action.id === id)?.category;

        const seatOne = new Set(ACTION_MOVE_ACTION_IDS.map(categoryOf));
        const seatTwo = new Set(ACTION_P2_MOVE_ACTION_IDS.map(categoryOf));

        expect(seatOne.size).toBe(1);
        expect(seatTwo.size).toBe(1);
        expect([...seatOne][0]).not.toBe([...seatTwo][0]);
        expect([...seatOne][0]).toBeDefined();
        expect([...seatTwo][0]).toBeDefined();
    });

    it('describes each row distinctly', () => {
        // Identical labels in the rebind panel would be unrebindable in
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
