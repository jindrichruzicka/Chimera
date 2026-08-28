/**
 * simulation/foundation/quick-start-contract.test.ts
 *
 * Type-level and runtime unit tests for the quick-start data contract:
 * QuickStartSeat, QuickStartAiSeat, QuickStartConfig.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 *
 * Invariants upheld:
 *   §3 Module Boundary Table — `simulation/foundation/quick-start-contract.ts`
 *     is a ZERO-IMPORT leaf: it declares no import at all, so it can never take
 *     a back-edge onto `renderer/`, `electron/`, or `apps/*`.
 *
 * The contract is type-only, so for every describe but the last the measuring
 * instrument is `tsc --noEmit -p simulation/tsconfig.json`: the bodies read
 * back literals they declare, and it is the annotation on each literal that
 * carries the claim. The zero-import describe at the end is the one runtime
 * measurement, and it ships a positive control.
 *
 * Tests written first (TDD — red confirmed: the module did not exist before
 * this commit; `tsc --noEmit -p simulation/tsconfig.json` reported
 * "Cannot find module './quick-start-contract.js'").
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuickStartSeat, QuickStartAiSeat, QuickStartConfig } from './quick-start-contract.js';

// ─── QuickStartSeat ───────────────────────────────────────────────────────────

describe('QuickStartSeat', () => {
    it('carries per-seat attributes', () => {
        const seat: QuickStartSeat = { attributes: { color: 'red' } };
        expect(seat.attributes).toEqual({ color: 'red' });
    });

    it('accepts a seat with no attributes (every field optional)', () => {
        const seat: QuickStartSeat = {};
        expect(seat.attributes).toBeUndefined();
    });
});

// ─── QuickStartAiSeat ─────────────────────────────────────────────────────────

describe('QuickStartAiSeat', () => {
    it('carries per-seat attributes exactly like a local seat', () => {
        const seat: QuickStartAiSeat = { attributes: { character: 'rogue' } };
        expect(seat.attributes).toEqual({ character: 'rogue' });
    });

    it('adds the AI-only omniscient flag on top of the seat attributes', () => {
        const seat: QuickStartAiSeat = { attributes: { character: 'rogue' }, omniscient: true };
        expect(seat.omniscient).toBe(true);
        expect(seat.attributes).toEqual({ character: 'rogue' });
    });

    it('is assignable to QuickStartSeat (an AI seat IS a seat)', () => {
        const aiSeat: QuickStartAiSeat = { attributes: { character: 'mage' } };
        const seat: QuickStartSeat = aiSeat;
        expect(seat.attributes).toEqual({ character: 'mage' });
    });
});

// ─── QuickStartConfig ─────────────────────────────────────────────────────────

describe('QuickStartConfig', () => {
    it('carries game params, host attributes and every seat kind', () => {
        const config: QuickStartConfig = {
            gameParams: { boardColor: 'slate' },
            hostAttributes: { color: 'blue' },
            localSeats: [{ attributes: { color: 'green' } }],
            aiSeats: [{ attributes: { color: 'red' }, omniscient: true }],
        };

        expect(config.gameParams).toEqual({ boardColor: 'slate' });
        expect(config.hostAttributes).toEqual({ color: 'blue' });
        expect(config.localSeats?.[0]?.attributes).toEqual({ color: 'green' });
        expect(config.aiSeats?.[0]?.attributes).toEqual({ color: 'red' });
        expect(config.aiSeats?.[0]?.omniscient).toBe(true);
    });

    it('accepts an empty config — every field is optional', () => {
        const config: QuickStartConfig = {};
        expect(config.gameParams).toBeUndefined();
        expect(config.hostAttributes).toBeUndefined();
        expect(config.localSeats).toBeUndefined();
        expect(config.aiSeats).toBeUndefined();
    });

    it('declares seat counts through attribute-carrying seat lists, never a bare number', () => {
        // A bare seat count cannot carry a seat's character/colour, so the
        // contract only admits seat OBJECTS. This pins that shape: an entry is
        // read as a seat descriptor, and its arity is the list length.
        const config: QuickStartConfig = {
            localSeats: [{ attributes: { color: 'green' } }, {}],
            aiSeats: [{}, { omniscient: true }],
        };
        expect(config.localSeats).toHaveLength(2);
        expect(config.aiSeats).toHaveLength(2);
    });
});

// ─── Zero-import leaf ─────────────────────────────────────────────────────────

describe('quick-start-contract.ts module boundary', () => {
    it('declares no import at all — a zero-import foundation leaf', () => {
        const source = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), 'quick-start-contract.ts'),
            'utf8',
        );
        // A module edge is a statement-initial `import`/`export` carrying a
        // `from` specifier, or a bare side-effect `import '…'`. Anchoring at the
        // line start keeps JSDoc prose (` * …`) out. The probe tokens are
        // assembled at runtime so this test file never matches itself.
        const IMPORT = `${'im'}${'port'}`;
        const EXPORT = `${'ex'}${'port'}`;
        const moduleEdge = new RegExp(
            `^\\s*(?:(?:${IMPORT}|${EXPORT})\\b[^\\n]*\\bfrom\\b|${IMPORT}\\s*['"])`,
            'm',
        );
        expect(moduleEdge.test(source)).toBe(false);
        // Positive control: the same predicate DOES fire on a sibling that
        // imports (game-lobby-contract.ts pulls messages-schemas.js).
        const sibling = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), 'game-lobby-contract.ts'),
            'utf8',
        );
        expect(moduleEdge.test(sibling)).toBe(true);
    });
});
