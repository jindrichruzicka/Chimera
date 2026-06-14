'use client';

import { Canvas } from '@react-three/fiber';
import React, { useState } from 'react';
import { OrthographicCamera, Vector3 } from 'three';
import type { GameScreenProps } from '@chimera/shared/game-screen-contract.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
} from '@chimera/shared/tactics.js';
import {
    parseTacticsSceneUnits,
    resolveTacticsBoardColor,
    resolveTacticsSelectionIntent,
    resolveTacticsUnitColor,
    type TacticsGridPoint,
    type TacticsSceneUnit,
    type TacticsSelectionIntent,
} from './tacticsSceneModel.js';
import {
    TACTICS_CAMERA_BOUNDS,
    TACTICS_CAMERA_LOOK_AT,
    TACTICS_CAMERA_POSITION,
} from './tacticsCamera.js';
import { TacticsGroundPlane } from './TacticsGroundPlane.js';
import { TacticsUnitPrimitive } from './TacticsUnitPrimitive.js';

const boardSceneStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    minHeight: 'calc(var(--ch-space-md) * 20)',
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
}: GameScreenProps): React.ReactElement | null {
    const [selectedUnitId, setSelectedUnitId] = useState<TacticsSceneUnit['id'] | null>(null);
    const isBoardInteractive =
        snapshot.isMyTurn && snapshot.gameResult === null && snapshot.phase !== 'ended';
    const [prevIsBoardInteractive, setPrevIsBoardInteractive] = useState(isBoardInteractive);
    const camera = React.useMemo(createTacticsCamera, []);

    if (prevIsBoardInteractive !== isBoardInteractive) {
        setPrevIsBoardInteractive(isBoardInteractive);
        if (!isBoardInteractive) {
            setSelectedUnitId(null);
        }
    }

    if (localPlayerId === undefined) {
        return (
            <div
                aria-label="Tactics board loading"
                data-testid="tactics-board-loading"
                style={boardFallbackStyle}
            />
        );
    }

    const units = parseTacticsSceneUnits(snapshot.entities, localPlayerId);

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
        if (intent.type === 'move-unit') {
            sendAction({
                type: TACTICS_MOVE_UNIT_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    unitId: intent.unitId,
                    x: intent.grid.x,
                    y: intent.grid.y,
                },
            });
            setSelectedUnitId(null);
            return;
        }
        if (intent.type === 'attack-unit') {
            sendAction({
                type: TACTICS_ATTACK_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    attackerId: intent.attackerId,
                    defenderId: intent.defenderId,
                },
            });
            setSelectedUnitId(null);
            return;
        }
        if (intent.type === 'reveal-tile') {
            sendAction({
                type: TACTICS_REVEAL_TILE_ACTION,
                playerId: localPlayerId,
                tick: snapshot.tick,
                payload: {
                    scoutId: intent.scoutId,
                    x: intent.grid.x,
                    y: intent.grid.y,
                },
            });
            setSelectedUnitId(null);
        }
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

    const boardColor = resolveTacticsBoardColor(snapshot.setup);

    return (
        <div aria-label="Tactics board" style={boardSceneStyle}>
            <Canvas camera={camera}>
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
                        color={resolveTacticsUnitColor(unit.ownerId, snapshot.setup)}
                        isSelected={isBoardInteractive && unit.id === selectedUnitId}
                        onSelect={handleUnitSelect}
                    />
                ))}
            </Canvas>
        </div>
    );
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
