/**
 * electron/main/lobby/SpectatorRegistry.test.ts
 *
 * Unit tests for SpectatorRegistry — the host-local ledger of admitted
 * spectators and the seat each one follows (Invariant #114).
 */

import { describe, it, expect } from 'vitest';
import { playerId } from '@chimera-engine/networking';
import { createNoopLogger } from '../logging/logger.js';
import { SpectatorRegistry } from './SpectatorRegistry.js';

const spec1 = playerId('spectator-1');
const spec2 = playerId('spectator-2');
const seatA = playerId('seat-a');
const seatB = playerId('seat-b');

function makeRegistry(): SpectatorRegistry {
    return new SpectatorRegistry(createNoopLogger());
}

describe('SpectatorRegistry', () => {
    it('starts empty', () => {
        const registry = makeRegistry();
        expect(registry.size).toBe(0);
        expect(registry.entries()).toEqual([]);
        expect(registry.has(spec1)).toBe(false);
        expect(registry.followedBy(spec1)).toBeUndefined();
    });

    it('add() registers a spectator following a seat', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);

        expect(registry.size).toBe(1);
        expect(registry.has(spec1)).toBe(true);
        expect(registry.followedBy(spec1)).toBe(seatA);
    });

    it('add() for an already-registered spectator re-points its followed seat', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);
        registry.add(spec1, seatB);

        expect(registry.size).toBe(1);
        expect(registry.followedBy(spec1)).toBe(seatB);
    });

    it('entries() preserves insertion order', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);
        registry.add(spec2, seatB);

        expect(registry.entries()).toEqual([
            [spec1, seatA],
            [spec2, seatB],
        ]);
    });

    it('remove() deletes the entry and reports whether one existed', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);

        expect(registry.remove(spec1)).toBe(true);
        expect(registry.has(spec1)).toBe(false);
        expect(registry.size).toBe(0);
        expect(registry.remove(spec1)).toBe(false);
    });

    it('remove() of an unknown spectator is a safe no-op', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);

        expect(registry.remove(spec2)).toBe(false);
        expect(registry.size).toBe(1);
    });

    it('repointFollowersOf() re-points only followers of the departed seat and returns the count', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);
        registry.add(spec2, seatB);

        const repointed = registry.repointFollowersOf(seatA, seatB);

        expect(repointed).toBe(1);
        expect(registry.followedBy(spec1)).toBe(seatB);
        expect(registry.followedBy(spec2)).toBe(seatB);
    });

    it('repointFollowersOf() returns 0 when no spectator follows the departed seat', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatB);

        expect(registry.repointFollowersOf(seatA, seatB)).toBe(0);
        expect(registry.followedBy(spec1)).toBe(seatB);
    });

    it('clear() empties the registry', () => {
        const registry = makeRegistry();
        registry.add(spec1, seatA);
        registry.add(spec2, seatB);

        registry.clear();

        expect(registry.size).toBe(0);
        expect(registry.entries()).toEqual([]);
    });
});
