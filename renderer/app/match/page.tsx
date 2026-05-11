'use client';

// renderer/app/match/page.tsx
//
// Match route — thin shell that mounts MatchShell with the active snapshot.
// Redirects to /lobby when snapshot is null after lobby-state hydration shows
// that no session is active. Direct-match boot can load this route before the
// first snapshot arrives and wait here while the hidden lobby auto-starts.
//
// Architecture reference: §4.33–§4.34 — GameScreenRegistry, MatchShell
// Module boundary tree: renderer/app/match/page.tsx # Thin shell: mounts MatchShell
//
// Invariants upheld:
//   #1  — Only PlayerSnapshot (never GameSnapshot) is consumed here.
//   #48 — MatchShell is game-agnostic; MatchScreenRegistry is the only
//          coupling point and lives HERE, not inside MatchShell.
//   #80 — MatchShell never imports from games/*; the board is passed as
//          children (GameScreenRegistry.board rendered by this page).
//   #88 — MatchShell wraps every screen in React.Suspense (see MatchShell.tsx).

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { type EngineAction, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { MatchScreenRegistry } from '@chimera/games/tactics/screens/index.js';
import { MatchShell } from '../../components/shell/MatchShell';
import { useSendAction } from '../../bridge/useSendAction';
import { useGameStore } from '../../state/gameStore';
import { useLobbyStore } from '../../state/lobbyStore';

type MatchActionType = 'engine:undo' | 'engine:redo' | 'engine:end_turn';

export default function MatchPage(): React.ReactElement | null {
    const router = useRouter();
    const snapshot = useGameStore((state) => state.snapshot);
    const lobbyState = useLobbyStore((state) => state.lobbyState);
    const hasLoadedInitialLobbyState = useLobbyStore((state) => state.hasLoadedInitialState);
    const sendAction = useSendAction();

    useEffect(() => {
        if (snapshot === null && hasLoadedInitialLobbyState && lobbyState === null) {
            router.replace('/lobby');
        }
    }, [hasLoadedInitialLobbyState, lobbyState, snapshot, router]);

    const dispatchMatchAction = (
        snapshotForAction: PlayerSnapshot,
        playerId: NonNullable<PlayerSnapshot['viewerId']>,
        type: MatchActionType,
        payload: Record<string, unknown>,
    ): void => {
        const action: EngineAction = {
            type,
            playerId,
            tick: snapshotForAction.tick,
            payload,
        };
        sendAction(action);
    };

    if (snapshot === null) {
        return null;
    }

    const resolvedPlayerId = snapshot.viewerId;

    return (
        <MatchShell
            registry={MatchScreenRegistry}
            snapshot={snapshot}
            sendAction={sendAction}
            canEndTurn={snapshot.isMyTurn}
            localPlayerId={resolvedPlayerId}
            {...(process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1'
                ? { fadeOutMs: 0, fadeInMs: 0 }
                : {})}
            onUndo={() =>
                dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:undo', { steps: 1 })
            }
            onRedo={() =>
                dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:redo', { steps: 1 })
            }
            onEndTurn={() => dispatchMatchAction(snapshot, resolvedPlayerId, 'engine:end_turn', {})}
        />
    );
}
