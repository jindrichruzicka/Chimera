'use client';

import React, { useState } from 'react';
import { GameCanvas, type OrthographicCameraConfig } from '@chimera-engine/renderer/components/r3f';
import {
    useAudioManager,
    useSpatialAudio,
    type AudioPosition,
} from '@chimera-engine/renderer/audio';
import { useTranslate } from '@chimera-engine/renderer/i18n';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
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
    type TacticsWorldPoint,
} from '../components/tacticsSceneModel.js';
import { resolveTacticsSfxCues, type TacticsSfxCue } from '../components/tacticsSfxDelta.js';
import { tacticsAudioRefs } from '../asset-manifest.js';
import { tacticsGridCoordinate } from '../simulation/actions.js';
import { applyBuffer } from '../simulation/commitment/buffer.js';
import { bufferHasAttack, type BufferedTacticsAction } from '../simulation/commitment/contract.js';
import { paletteFromCollections } from '../content/tacticsContent.js';
import {
    TACTICS_CAMERA_BOUNDS,
    TACTICS_CAMERA_LOOK_AT,
    TACTICS_CAMERA_POSITION,
    TACTICS_CAMERA_UP,
} from '../components/tacticsCamera.js';
import { TacticsGroundPlane } from '../components/TacticsGroundPlane.js';
import { TacticsMinimap } from '../components/TacticsMinimap.js';
import { TacticsUnitPrimitive } from '../components/TacticsUnitPrimitive.js';
import styles from './TacticsDemoBoard.module.css';
import { parseRevealedTurn } from '../simulation/commitment/revealView.js';
import {
    selectBuffer,
    selectCommittedLatch,
    toOptimisticBase,
    useCommitmentBuffer,
} from '../components/useCommitmentBuffer.js';
import { BOARD_KEYS } from '../shell/translations/keys.js';

const boardSceneStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    minHeight: 'calc(var(--ch-space-md) * 20)',
};

/**
 * Reveal playback overlay: in commitment mode the host reveals each player's
 * committed turn in deterministic order. The board surfaces the most
 * recent revealed turn here — non-interactive and corner-anchored so it never
 * occludes board clicks (cf. the chat drawer). The authoritative snapshot
 * remains the source of truth for unit positions; this is the playback hook.
 *
 * It is positioned and rendered AFTER the `<GameCanvas>` — camera-system.md
 * §4.22 "Canvas-fit rules".
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

// Declarative engine camera (§4.22): fixed 3:2 world-unit frustum, Z-up board
// plane. GameCanvas derives `manual` from the explicit frustum, and reconciles
// it with the canvas through the default `letterbox` fit — the board is
// pillarboxed on a window wider than 3:2 (see the TACTICS_CAMERA_BOUNDS
// comment). Module-level so GameCanvas's reference-compared memo keeps one
// camera per mount. The e2e pixel projection mirrors these numbers —
// TACTICS_CANVAS_WORLD_BOUNDS in e2e/pages/GamePage.ts; the GamePage sync
// guards go red if they drift.
const TACTICS_GAME_CANVAS_CAMERA = {
    mode: 'orthographic',
    position: TACTICS_CAMERA_POSITION,
    lookAt: TACTICS_CAMERA_LOOK_AT,
    up: TACTICS_CAMERA_UP,
    frustum: TACTICS_CAMERA_BOUNDS,
} as const satisfies OrthographicCameraConfig;

// Spatial band for the board's positioned SFX, in board world units: full
// volume within a tile of the listener, and — under the engine's 'linear'
// default — silent past the board's long diagonal.
const TACTICS_SFX_FULL_VOLUME_DISTANCE = 1;
const TACTICS_SFX_FALLOFF_DISTANCE = 6;
const TACTICS_STEP_VOLUME = 0.45;
const TACTICS_SWORD_HIT_VOLUME = 0.65;

/**
 * The listener's resting anchor: the board CENTRE the camera looks AT — taken
 * from `TACTICS_CAMERA_LOOK_AT`, and deliberately NOT `TACTICS_CAMERA_POSITION`.
 * The camera hangs twelve world units above the board looking straight down; a
 * listener bound to it would put every sound ~12 units away and pan the whole
 * board through a near-vertical axis. The pose is what the player listens FROM
 * — do not "fix" this to the camera.
 */
const TACTICS_BOARD_CENTRE_FOCUS: TacticsWorldPoint = {
    x: TACTICS_CAMERA_LOOK_AT[0],
    y: TACTICS_CAMERA_LOOK_AT[1],
    z: TACTICS_CAMERA_LOOK_AT[2],
};

/** The last positioned SFX, mirrored into the DOM — audio is unobservable to Playwright. */
interface PositionedSfxMarker {
    readonly ref: string;
    readonly position: AudioPosition;
}

/** The clip and level each derived cue plays at. */
const TACTICS_SFX_FOR_CUE = {
    move: { ref: tacticsAudioRefs.step, volume: TACTICS_STEP_VOLUME },
    hit: { ref: tacticsAudioRefs.swordHit, volume: TACTICS_SWORD_HIT_VOLUME },
} as const satisfies Record<
    TacticsSfxCue['kind'],
    { readonly ref: AssetRef<AudioClipAsset>; readonly volume: number }
>;

/**
 * The board's spatial-audio seam: anchors the one app listener at the board
 * focus, plays the positioned SFX the latest projection owes, and mirrors the
 * observable facts into hidden DOM markers, the way `TacticsAmbience` mirrors
 * `data-track`. A component of its own so its hooks mount only once the board
 * has a playable scene (past the loading/empty fallbacks), keeping the parent's
 * hook order unconditional.
 *
 * `units` is the AUTHORITATIVE projection, never the optimistic view the board
 * renders: a buffered commitment action is not a fact about the match until the
 * reveal applies it, so it stays silent while it moves the unit on screen.
 */
function TacticsBoardSpatialAudio({
    focus,
    units,
    tick,
}: {
    readonly focus: TacticsWorldPoint;
    readonly units: readonly TacticsSceneUnit[];
    readonly tick: number;
}): React.ReactElement {
    const audioManager = useAudioManager();
    const { setListener } = useSpatialAudio();
    const [lastPlayed, setLastPlayed] = useState<PositionedSfxMarker | null>(null);
    // The projection the cues are measured against. A ref, not state: it is the
    // effect's own bookkeeping, and re-rendering on it would say nothing new.
    const previousRef = React.useRef<{
        readonly tick: number;
        readonly units: readonly TacticsSceneUnit[];
    }>({ tick, units });

    React.useEffect(() => {
        // Keyed on the focus — which moves on selection, never continuously —
        // so the pose is written per focus change, not per frame or per render.
        setListener({ position: [focus.x, focus.y, focus.z] });
    }, [setListener, focus.x, focus.y, focus.z]);

    React.useEffect(() => {
        const previous = previousRef.current;
        previousRef.current = { tick, units };

        // Only a tick that moved FORWARD is a turn the player watched happen. A
        // restored save, an undo, or a re-projection onto a new seat can move
        // every unit at once with no turn behind it; those re-baseline in
        // silence rather than firing a burst of steps.
        if (tick <= previous.tick) {
            return;
        }

        for (const cue of resolveTacticsSfxCues(previous.units, units)) {
            const { ref, volume } = TACTICS_SFX_FOR_CUE[cue.kind];
            const position: AudioPosition = [cue.world.x, cue.world.y, cue.world.z];
            audioManager.play(ref, {
                bus: 'sfx',
                volume,
                spatial: {
                    position,
                    fullVolumeDistance: TACTICS_SFX_FULL_VOLUME_DISTANCE,
                    falloffDistance: TACTICS_SFX_FALLOFF_DISTANCE,
                },
            });
            setLastPlayed({ ref: String(ref), position });
        }
    }, [audioManager, tick, units]);

    return (
        <>
            <span
                data-testid="tactics-audio-listener"
                data-position={`${focus.x},${focus.y},${focus.z}`}
                hidden
            />
            {lastPlayed !== null && (
                <span
                    data-testid="tactics-audio-sfx"
                    data-ref={lastPlayed.ref}
                    data-position={lastPlayed.position.join(',')}
                    hidden
                />
            )}
        </>
    );
}

// The minimap's own module-level camera (one stable config per mount): the
// same top-down world framing as the board camera, on the overlay canvas.
const TACTICS_MINIMAP_CAMERA = {
    mode: 'orthographic',
    position: TACTICS_CAMERA_POSITION,
    lookAt: TACTICS_CAMERA_LOOK_AT,
    up: TACTICS_CAMERA_UP,
    frustum: TACTICS_CAMERA_BOUNDS,
} as const satisfies OrthographicCameraConfig;

export function TacticsDemoBoard({
    snapshot,
    localPlayerId,
    sendAction,
    content,
    reveal,
}: GameScreenProps): React.ReactElement | null {
    const t = useTranslate();
    // Interpret the generic content prop into this game's colour hex maps. Empty
    // until content loads, so the resolvers fall back to the default hexes.
    const palette = paletteFromCollections(content ?? {});
    const [selectedUnitId, setSelectedUnitId] = useState<TacticsSceneUnit['id'] | null>(null);

    // The projection as received, before any optimistic buffer is laid over it.
    // This is what the positioned SFX are derived from — see
    // `TacticsBoardSpatialAudio`. Memoised so a re-render that changed neither
    // the entities nor the seat hands the effect the same list it already has.
    const authoritativeUnits = React.useMemo(
        () => parseTacticsSceneUnits(snapshot.entities, localPlayerId),
        [snapshot.entities, localPlayerId],
    );

    // Commitment battle mode: move/attack/reveal selections are buffered locally
    // (never dispatched) and shown as an optimistic view until the player commits.
    // The buffer is shared with the HUD via this module store.
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
                aria-label={t(BOARD_KEYS.loadingAriaLabel)}
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
                aria-label={t(BOARD_KEYS.emptyAriaLabel)}
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
            // so an illegal action is simply not buffered. Nothing is played
            // here: a buffered action is not yet a fact about the match, and
            // `TacticsBoardSpatialAudio` derives every cue from the authoritative
            // projection, so the turn becomes audible — to both seats — at the
            // reveal that applies it.
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
    const selectedUnit = units.find((unit) => unit.id === selectedUnitId);
    const listenerFocus = selectedUnit?.world ?? TACTICS_BOARD_CENTRE_FOCUS;

    return (
        <div aria-label={t(BOARD_KEYS.ariaLabel)} style={boardSceneStyle}>
            <GameCanvas camera={TACTICS_GAME_CANVAS_CAMERA}>
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
            </GameCanvas>
            {revealedTurn !== null && (
                <div
                    data-testid="tactics-reveal"
                    data-player={revealedTurn.playerId}
                    data-has-attack={String(bufferHasAttack(revealedTurn.actions))}
                    style={revealOverlayStyle}
                >
                    {t(BOARD_KEYS.revealed, {
                        player: revealedTurn.playerId,
                        actions: revealedTurn.actions.map((action) => action.type).join(', '),
                    })}
                </div>
            )}
            <div className={styles['minimap']} data-testid="tactics-minimap">
                <GameCanvas
                    role="overlay"
                    camera={TACTICS_MINIMAP_CAMERA}
                    // The index-signature lookup types as possibly-undefined;
                    // the class exists in the sibling stylesheet, and
                    // exactOptionalPropertyTypes forbids handing an explicit
                    // undefined to the curated optional prop.
                    className={styles['minimapCanvas'] ?? ''}
                >
                    <TacticsMinimap
                        units={units}
                        boardColor={boardColor}
                        unitColorFor={(unit) =>
                            resolveTacticsUnitColor(
                                unit.ownerId,
                                snapshot.setup,
                                palette.playerColorHex,
                            )
                        }
                    />
                </GameCanvas>
            </div>
            <TacticsBoardSpatialAudio
                focus={listenerFocus}
                units={authoritativeUnits}
                tick={snapshot.tick}
            />
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

export default TacticsDemoBoard;
