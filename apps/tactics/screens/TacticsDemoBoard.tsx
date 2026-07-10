'use client';

import { Canvas } from '@react-three/fiber';
import React, { useState } from 'react';
import { OrthographicCamera, Vector3 } from 'three';
import { PerfProbe } from '@chimera-engine/renderer/components/r3f';
import type { GameScreenProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
    readTacticsTurnMode,
} from '@chimera-engine/tactics/simulation/constants.js';
import {
    parseTacticsSceneUnits,
    parseTacticsSeatCommitted,
    resolveTacticsBoardColor,
    resolveTacticsSelectionIntent,
    resolveTacticsUnitColor,
    type TacticsGridPoint,
    type TacticsSceneUnit,
    type TacticsSelectionIntent,
} from '../scene/tacticsSceneModel.js';
import { tacticsGridCoordinate } from '../simulation/actions.js';
import { applyBuffer } from '../simulation/commitment/buffer.js';
import { bufferHasAttack, type BufferedTacticsAction } from '../simulation/commitment/contract.js';
import { paletteFromCollections } from '../content/tacticsContent.js';
import {
    TACTICS_CAMERA_BOUNDS,
    TACTICS_CAMERA_LOOK_AT,
    TACTICS_CAMERA_POSITION,
} from '../scene/tacticsCamera.js';
import { TacticsGroundPlane } from '../scene/TacticsGroundPlane.js';
import { TacticsUnitPrimitive } from '../scene/TacticsUnitPrimitive.js';
import { parseRevealedTurn } from '../simulation/commitment/revealView.js';
import {
    selectBuffer,
    selectCommittedLatch,
    toOptimisticBase,
    useCommitmentBuffer,
} from './useCommitmentBuffer.js';

const boardSceneStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    minHeight: 'calc(var(--ch-space-md) * 20)',
};

/**
 * Reveal playback overlay (F54 / T9): in commitment mode the host reveals each
 * player's committed turn in deterministic order. The board surfaces the most
 * recent revealed turn here — non-interactive and corner-anchored so it never
 * occludes board clicks (cf. the chat drawer). The authoritative snapshot
 * remains the source of truth for unit positions; this is the playback hook.
 */
const revealOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'var(--ch-space-sm)',
    right: 'var(--ch-space-sm)',
    pointerEvents: 'none',
    color: 'var(--ch-color-text-secondary)',
    fontSize: 'var(--ch-font-size-sm)',
};

const boardFallbackStyle: React.CSSProperties = {
    display: 'grid',
    placeItems: 'center',
    width: '100%',
    minHeight: 'calc(var(--ch-space-md) * 20)',
    color: 'var(--ch-color-text-secondary)',
};

type ManualOrthographicCamera = OrthographicCamera & { manual: true };

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
    content,
    reveal,
}: GameScreenProps): React.ReactElement | null {
    // Interpret the generic content prop into this game's colour hex maps. Empty
    // until content loads, so the resolvers fall back to the default hexes.
    const palette = paletteFromCollections(content ?? {});
    const [selectedUnitId, setSelectedUnitId] = useState<TacticsSceneUnit['id'] | null>(null);

    // Commitment battle mode: move/attack/reveal selections are buffered locally
    // (never dispatched) and shown as an optimistic view until the player commits
    // (#730, F54). The buffer is shared with the HUD via this module store.
    const isCommitment = readTacticsTurnMode(snapshot.setup?.matchSettings) === 'commitment';
    const buffer = useCommitmentBuffer(selectBuffer);
    const committedLatch = useCommitmentBuffer(selectCommittedLatch);
    const appendBufferedAction = useCommitmentBuffer((state) => state.append);

    // In commitment mode both seats act in parallel; the local board stays
    // interactive until THIS player commits, then goes inert. `localCommitted` is
    // the projected authoritative marker; `committedLatch` covers the brief window
    // after the Commit click before the snapshot round-trips.
    const localCommitted =
        isCommitment &&
        localPlayerId !== undefined &&
        parseTacticsSeatCommitted(snapshot.players, localPlayerId);
    const hasCommitted = committedLatch || localCommitted;

    const isBoardInteractive =
        snapshot.isMyTurn &&
        !hasCommitted &&
        snapshot.gameResult === null &&
        snapshot.phase !== 'ended';
    const [prevIsBoardInteractive, setPrevIsBoardInteractive] = useState(isBoardInteractive);
    const camera = React.useMemo(createTacticsCamera, []);

    if (prevIsBoardInteractive !== isBoardInteractive) {
        setPrevIsBoardInteractive(isBoardInteractive);
        if (!isBoardInteractive) {
            setSelectedUnitId(null);
        }
    }

    // Clear the optimistic buffer when a fresh commitment turn begins (the local
    // commit marker clears once the reveal advances the turn), when the rendered
    // SEAT changes (a host hot-seat handoff re-projects a new viewer without
    // remounting the board — `electron/main` `scheduleAutoLocalSeatHandoff`), and
    // on unmount — so a prior seat's / turn's / match's buffer never overlays the
    // board.
    const prevSeatRef = React.useRef(localPlayerId);
    React.useEffect(() => {
        const seatChanged = prevSeatRef.current !== localPlayerId;
        prevSeatRef.current = localPlayerId;
        if (seatChanged || !isCommitment || !localCommitted) {
            useCommitmentBuffer.getState().reset();
        }
    }, [isCommitment, localCommitted, localPlayerId]);
    React.useEffect(() => {
        return () => {
            useCommitmentBuffer.getState().reset();
        };
    }, []);

    if (localPlayerId === undefined) {
        return (
            <div
                aria-label="Tactics board loading"
                data-testid="tactics-board-loading"
                style={boardFallbackStyle}
            />
        );
    }

    // Optimistic view: in commitment mode the board renders the local player's
    // own units at their buffered positions. The opponent is unaffected (their
    // moves are not dispatched pre-reveal), so secrecy holds automatically.
    const sceneEntities =
        isCommitment && buffer.length > 0
            ? applyBuffer(toOptimisticBase(snapshot), buffer, localPlayerId).entities
            : snapshot.entities;
    const units = parseTacticsSceneUnits(sceneEntities, localPlayerId);

    if (units.length === 0) {
        return (
            <div
                aria-label="No visible tactics units"
                data-testid="tactics-board-empty"
                style={boardFallbackStyle}
            />
        );
    }

    const handleIntent = (intent: TacticsSelectionIntent): void => {
        if (!isBoardInteractive) {
            return;
        }

        if (intent.type === 'select-own-unit' || intent.type === 'select-opponent-unit') {
            setSelectedUnitId(intent.unitId);
            return;
        }

        const buffered = bufferedActionForIntent(intent);
        if (buffered === null) {
            return;
        }

        if (isCommitment) {
            // Buffer locally — never dispatched to the host until commit/reveal.
            // The kernel re-validates against the optimistic view (stamina, etc.),
            // so an illegal action is simply not buffered.
            appendBufferedAction(toOptimisticBase(snapshot), buffered, localPlayerId);
            setSelectedUnitId(null);
            return;
        }

        // Sequential mode: dispatch straight to the host (unchanged behaviour).
        // The buffered payload is structurally a plain object; the brand types
        // just lack an index signature (same cast as the host re-dispatch path).
        sendAction({
            type: buffered.type,
            playerId: localPlayerId,
            tick: snapshot.tick,
            payload: buffered.payload as unknown as Record<string, unknown>,
        });
        setSelectedUnitId(null);
    };

    const handleUnitSelect = (unitId: TacticsSceneUnit['id']): void => {
        handleIntent(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId,
                selectedUnitId,
                target: { type: 'unit', unitId },
            }),
        );
    };

    const handleGroundSelect = (grid: TacticsGridPoint): void => {
        handleIntent(
            resolveTacticsSelectionIntent({
                units,
                localPlayerId,
                selectedUnitId,
                target: { type: 'ground', grid },
            }),
        );
    };

    const handleGroundReveal = (grid: TacticsGridPoint): void => {
        if (selectedUnitId === null) {
            return;
        }

        const selectedUnit = units.find((unit) => unit.id === selectedUnitId);
        if (selectedUnit?.ownership !== 'own') {
            return;
        }

        handleIntent({ type: 'reveal-tile', scoutId: selectedUnit.id, grid });
    };

    const boardColor = resolveTacticsBoardColor(snapshot.setup, palette.boardColorHex);
    const revealedTurn = parseRevealedTurn(reveal);

    return (
        <div aria-label="Tactics board" style={boardSceneStyle}>
            {revealedTurn !== null && (
                <div
                    data-testid="tactics-reveal"
                    data-player={revealedTurn.playerId}
                    data-has-attack={String(bufferHasAttack(revealedTurn.actions))}
                    style={revealOverlayStyle}
                >
                    {`Revealed ${revealedTurn.playerId}: ${revealedTurn.actions
                        .map((action) => action.type)
                        .join(', ')}`}
                </div>
            )}
            <Canvas camera={camera}>
                <PerfProbe />
                <ambientLight intensity={0.65} />
                <directionalLight intensity={0.9} position={[3, 6, 4]} />
                <TacticsGroundPlane
                    color={boardColor}
                    onSelectGridPoint={handleGroundSelect}
                    onRevealGridPoint={handleGroundReveal}
                />
                {units.map((unit) => (
                    <TacticsUnitPrimitive
                        key={unit.id}
                        unit={unit}
                        color={resolveTacticsUnitColor(
                            unit.ownerId,
                            snapshot.setup,
                            palette.playerColorHex,
                        )}
                        isSelected={isBoardInteractive && unit.id === selectedUnitId}
                        onSelect={handleUnitSelect}
                    />
                ))}
            </Canvas>
        </div>
    );
}

/**
 * Map a resolved board intent to its bufferable action shape (`{ type, payload }`),
 * or `null` for non-action intents (select / noop). The same shape is buffered in
 * commitment mode and dispatched (with playerId/tick) in sequential mode, so the
 * two paths cannot diverge.
 */
function bufferedActionForIntent(intent: TacticsSelectionIntent): BufferedTacticsAction | null {
    if (intent.type === 'move-unit') {
        return {
            type: TACTICS_MOVE_UNIT_ACTION,
            payload: {
                unitId: intent.unitId,
                x: tacticsGridCoordinate(intent.grid.x),
                y: tacticsGridCoordinate(intent.grid.y),
            },
        };
    }
    if (intent.type === 'attack-unit') {
        return {
            type: TACTICS_ATTACK_ACTION,
            payload: { attackerId: intent.attackerId, defenderId: intent.defenderId },
        };
    }
    if (intent.type === 'reveal-tile') {
        return {
            type: TACTICS_REVEAL_TILE_ACTION,
            payload: {
                scoutId: intent.scoutId,
                x: tacticsGridCoordinate(intent.grid.x),
                y: tacticsGridCoordinate(intent.grid.y),
            },
        };
    }
    return null;
}

function createTacticsCamera(): ManualOrthographicCamera {
    const camera = new OrthographicCamera(
        TACTICS_CAMERA_BOUNDS.left,
        TACTICS_CAMERA_BOUNDS.right,
        TACTICS_CAMERA_BOUNDS.top,
        TACTICS_CAMERA_BOUNDS.bottom,
        TACTICS_CAMERA_BOUNDS.near,
        TACTICS_CAMERA_BOUNDS.far,
    ) as ManualOrthographicCamera;

    camera.manual = true;
    camera.up.set(0, 0, 1);
    camera.position.set(...TACTICS_CAMERA_POSITION);
    camera.lookAt(new Vector3(...TACTICS_CAMERA_LOOK_AT));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    return camera;
}

export default TacticsDemoBoard;
