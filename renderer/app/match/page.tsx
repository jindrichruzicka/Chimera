'use client';

// renderer/app/match/page.tsx
//
// Match route — thin shell that mounts MatchShell with the active snapshot.
// Redirects to /lobby when snapshot is null (cold load or session end).
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
import { useLobbyUiStore } from '../../state/lobbyUiStore';

type MatchActionType = 'engine:undo' | 'engine:redo' | 'engine:end_turn';

export default function MatchPage(): React.ReactElement | null {
    const router = useRouter();
    const snapshot = useGameStore((state) => state.snapshot);
    const localPlayerId = useLobbyUiStore((state) => state.localPlayerId);
    const sendAction = useSendAction();

    useEffect(() => {
        if (snapshot === null) {
            router.replace('/lobby');
        }
    }, [snapshot, router]);

    const dispatchMatchAction = (
        snapshotForAction: PlayerSnapshot,
        type: MatchActionType,
        payload: Record<string, unknown>,
    ): void => {
        if (localPlayerId === null) {
            return;
        }
        const action: EngineAction = {
            type,
            playerId: localPlayerId,
            tick: snapshotForAction.tick,
            payload,
        };
        sendAction(action);
    };

    if (snapshot === null) {
        return null;
    }

    const Board = MatchScreenRegistry.board;

    return (
        <MatchShell
            tick={snapshot.tick}
            canUndo={snapshot.undoMeta.canUndo}
            canRedo={snapshot.undoMeta.canRedo}
            canEndTurn={snapshot.isMyTurn}
            snapshot={snapshot}
            sendAction={sendAction}
            isGameOver={snapshot.phase === 'ended'}
            matchResult={snapshot.matchResult}
            {...(MatchScreenRegistry.hud === undefined ? {} : { hud: MatchScreenRegistry.hud })}
            {...(MatchScreenRegistry.matchResultBanner === undefined
                ? {}
                : { matchResultBanner: MatchScreenRegistry.matchResultBanner })}
            {...(localPlayerId === null ? {} : { localPlayerId })}
            {...(localPlayerId === null
                ? {}
                : {
                      onUndo: () => dispatchMatchAction(snapshot, 'engine:undo', { steps: 1 }),
                      onRedo: () => dispatchMatchAction(snapshot, 'engine:redo', { steps: 1 }),
                      onEndTurn: () => dispatchMatchAction(snapshot, 'engine:end_turn', {}),
                  })}
        >
            <Board
                snapshot={snapshot}
                sendAction={sendAction}
                {...(localPlayerId === null ? {} : { localPlayerId })}
            />
        </MatchShell>
    );
}
