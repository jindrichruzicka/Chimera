/**
 * electron/main/lobby/joinClassifier.test.ts
 *
 * Unit tests for the pure join-classification decision function: given the
 * current match phase, whether the JOIN is a reconnect, the game's spectator
 * capability, and the host allow-spectators toggle, decide whether the JOIN is
 * admitted as a player, admitted as a spectator, or rejected.
 *
 * Architecture: §4.14 — LobbyServer JOIN handshake / spectator admission.
 * Prepares Invariant #114 — spectators are read-only session viewers, admitted
 * only in a running match when the game declares capability AND the host enables
 * it, else REJECT `match_in_progress`.
 */

import { describe, it, expect } from 'vitest';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';
import type { GameSpectatorSupport } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import {
    REJECT_REASON_MATCH_IN_PROGRESS,
    REJECT_REASON_SPECTATORS_DISABLED,
} from '@chimera-engine/simulation/foundation/messages.js';
import { classifyJoin } from './joinClassifier.js';

const SUPPORTED: GameSpectatorSupport = { mode: 'perspective' };
const LOBBY = gamePhase('lobby');
const RUNNING = gamePhase('playing');

describe('classifyJoin', () => {
    it('admits a lobby-phase fresh join as a player', () => {
        expect(
            classifyJoin({
                phase: LOBBY,
                reconnect: false,
                spectatorSupport: SUPPORTED,
                allowSpectators: true,
            }),
        ).toEqual({ role: 'player' });
    });

    it('admits a lobby-phase reconnect as a player', () => {
        expect(
            classifyJoin({
                phase: LOBBY,
                reconnect: true,
                spectatorSupport: undefined,
                allowSpectators: false,
            }),
        ).toEqual({ role: 'player' });
    });

    it('admits a running-match reconnect as a player (unchanged re-sync)', () => {
        // A reconnect keeps its seat regardless of spectator policy.
        expect(
            classifyJoin({
                phase: RUNNING,
                reconnect: true,
                spectatorSupport: undefined,
                allowSpectators: false,
            }),
        ).toEqual({ role: 'player' });
    });

    it('admits a running-match fresh join as a spectator when capable AND enabled', () => {
        expect(
            classifyJoin({
                phase: RUNNING,
                reconnect: false,
                spectatorSupport: SUPPORTED,
                allowSpectators: true,
            }),
        ).toEqual({ role: 'spectator' });
    });

    it('rejects a running-match fresh join with match_in_progress when the game is not spectator-capable', () => {
        expect(
            classifyJoin({
                phase: RUNNING,
                reconnect: false,
                spectatorSupport: undefined,
                allowSpectators: true,
            }),
        ).toEqual({ reject: REJECT_REASON_MATCH_IN_PROGRESS });
    });

    it('rejects a running-match fresh join with spectators_disabled when capable but the host toggle is off', () => {
        expect(
            classifyJoin({
                phase: RUNNING,
                reconnect: false,
                spectatorSupport: SUPPORTED,
                allowSpectators: false,
            }),
        ).toEqual({ reject: REJECT_REASON_SPECTATORS_DISABLED });
    });
});
