'use client';

// The action app's match screen — the engine's first realtime playfield.
//
// Three things happen here and nowhere else in this app:
//
//   1. The arena is MOUNTED: one `GameCanvas role="main"` on the `top-down`
//      preset, the ground plane, and one mesh per primitive, all read off the
//      projected snapshot through `parseActionScene`.
//   2. Movement keys become VELOCITY, per SEAT. A held key is one press event
//      and one release event (see `@chimera-engine/renderer/input` for when
//      each arrives) — each seat keeps its own set of held directions and
//      derives one velocity from it (`components/actionVelocityInput.ts`).
//   3. A click on a primitive becomes `action:select-primitive`.
//
// TWO SEATS on one keyboard. A quick-started match may open a pass-and-play
// seat beside the host's own; the shell marked it with the `control` attribute
// and `findActionPassAndPlaySeat` reads it back off `snapshot.setup`. Its
// cluster is mounted as a SECOND `<ActionSeatMovement>` rather than folded into
// the first, because the two seats have to hold their keys independently: one
// shared held set would sum both players' keys into one velocity and move both
// primitives as one.
//
// What is deliberately NOT here: per-frame dispatch. `action:set-velocity` is
// sent only when a seat's derived velocity CHANGES, so holding a key costs one
// action, and the host's heartbeat — not the renderer's frame rate — is what
// moves the primitive. A screen that dispatched per frame would flood the host
// at the display's refresh rate and make the same match play differently on
// different hardware.
//
// Module boundary: the renderer is reached only through its public barrels
// (Invariant #96) — here `components/r3f` and `input`.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameCanvas } from '@chimera-engine/renderer/components/r3f';
import { useInputAction } from '@chimera-engine/renderer/input';
import type { GameScreenProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';

import {
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
} from '../simulation/constants.js';
import {
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_MOVE_UP_ACTION,
    ACTION_P2_MOVE_DOWN_ACTION,
    ACTION_P2_MOVE_LEFT_ACTION,
    ACTION_P2_MOVE_RIGHT_ACTION,
    ACTION_P2_MOVE_UP_ACTION,
    type ActionMoveActionId,
} from '../input-action-ids.js';
import { ActionGroundPlane } from '../components/ActionGroundPlane.js';
import { ActionPrimitiveMesh } from '../components/ActionPrimitiveMesh.js';
import {
    NO_HELD_DIRECTIONS,
    setHeldDirection,
    velocityFromHeld,
    type ActionHeldDirections,
} from '../components/actionVelocityInput.js';
import { parseActionScene } from '../components/actionSceneModel.js';
import { findActionPassAndPlaySeat } from '../components/actionSeatModel.js';
import styles from './ActionPlayfield.module.css';

const AMBIENT_INTENSITY = 0.6;
const KEY_LIGHT_POSITION = [6, 12, 6] as const;
const KEY_LIGHT_INTENSITY = 1.1;

/** One seat's four movement action ids, in the order the directions read. */
interface ActionSeatKeys {
    readonly up: ActionMoveActionId;
    readonly down: ActionMoveActionId;
    readonly left: ActionMoveActionId;
    readonly right: ActionMoveActionId;
}

const ARROW_KEYS: ActionSeatKeys = {
    up: ACTION_MOVE_UP_ACTION,
    down: ACTION_MOVE_DOWN_ACTION,
    left: ACTION_MOVE_LEFT_ACTION,
    right: ACTION_MOVE_RIGHT_ACTION,
};

const WASD_KEYS: ActionSeatKeys = {
    up: ACTION_P2_MOVE_UP_ACTION,
    down: ACTION_P2_MOVE_DOWN_ACTION,
    left: ACTION_P2_MOVE_LEFT_ACTION,
    right: ACTION_P2_MOVE_RIGHT_ACTION,
};

/** Sends one action for one seat, stamped with the tick current at the call. */
type ActionDispatch = (
    type: string,
    payload: Record<string, unknown>,
    forPlayerId: PlayerId,
) => void;

export function ActionPlayfield({
    snapshot,
    localPlayerId,
    sendAction,
    isHost,
}: GameScreenProps): React.ReactElement {
    const scene = parseActionScene(snapshot.entities);
    const viewerId = localPlayerId ?? snapshot.viewerId;
    // The contract reads an absent `isHost` as host (a purely local game with no
    // lobby), so the default is what a quick-started solo match arrives as.
    const passAndPlaySeat = findActionPassAndPlaySeat(snapshot.setup, viewerId, isHost ?? true);

    // Everything `dispatch` needs, held in REFS and re-pointed on every render.
    //
    // Refs rather than closed-over values because `dispatch` itself is pinned to
    // `[]`: the primitive meshes and the seat clusters hold it across renders,
    // and re-creating it per render would re-fire their effects on every
    // heartbeat. Anything captured directly would therefore be frozen at the
    // render that built the closure — and at this heartbeat that staleness is
    // not subtle. A primitive clicked a second after the match started would
    // stamp its action with a tick ten beats old.
    const sendActionRef = useRef(sendAction);
    sendActionRef.current = sendAction;
    const tickRef = useRef(snapshot.tick);
    tickRef.current = snapshot.tick;

    const dispatch = useCallback<ActionDispatch>((type, payload, forPlayerId): void => {
        sendActionRef.current({
            type,
            playerId: forPlayerId,
            tick: tickRef.current,
            payload,
        });
    }, []);

    const handleSelect = useCallback(
        (entityId: string): void => {
            // The VIEWER's seat, always: a click is made by whoever is holding
            // the mouse, and that is the machine's own player. The pass-and-play
            // seat claims a primitive by starting the match on it.
            dispatch(ACTION_SELECT_PRIMITIVE_ACTION, { entityId }, viewerId);
        },
        [dispatch, viewerId],
    );

    return (
        <div className={styles['sceneHost']}>
            <ActionSeatMovement seatId={viewerId} keys={ARROW_KEYS} dispatch={dispatch} />
            {passAndPlaySeat !== null && (
                <ActionSeatMovement seatId={passAndPlaySeat} keys={WASD_KEYS} dispatch={dispatch} />
            )}
            <GameCanvas camera="top-down" role="main">
                <ambientLight intensity={AMBIENT_INTENSITY} />
                <directionalLight
                    castShadow
                    intensity={KEY_LIGHT_INTENSITY}
                    position={KEY_LIGHT_POSITION}
                />
                {scene.ground !== null && <ActionGroundPlane ground={scene.ground} />}
                {scene.primitives.map((primitive) => (
                    <ActionPrimitiveMesh
                        key={primitive.id}
                        primitive={primitive}
                        isControlled={primitive.ownerId === viewerId}
                        onSelect={handleSelect}
                    />
                ))}
            </GameCanvas>
            <p className={styles['hint']}>
                {passAndPlaySeat === null
                    ? 'Arrow keys move · click a primitive to take it'
                    : 'Arrow keys move player 1 · WASD moves player 2 · click a primitive to take it'}
            </p>
        </div>
    );
}

/**
 * Subscribes ONE seat's four movement actions, folds each press/release into
 * that seat's held set, and dispatches a velocity for it whenever the derived
 * value changes.
 *
 * A component per seat because the state has to be per seat: `useInputAction`
 * is one subscription per call and the ids must be listed statically, so a loop
 * inside the parent would break the rules of hooks — and, more importantly, one
 * held set shared between two players would sum both their keys into a single
 * velocity. It renders nothing; mounting it IS the subscription, so unmounting
 * the second seat's cluster is what unsubscribes WASD.
 */
function ActionSeatMovement({
    seatId,
    keys,
    dispatch,
}: {
    readonly seatId: PlayerId;
    readonly keys: ActionSeatKeys;
    readonly dispatch: ActionDispatch;
}): null {
    const [held, setHeld] = useState(NO_HELD_DIRECTIONS);

    // The last velocity actually dispatched for this seat. A ref rather than
    // state: it is read to decide whether to dispatch at all, and re-rendering
    // on it would just re-run the same comparison against the same value.
    const sentVelocityRef = useRef(velocityFromHeld(NO_HELD_DIRECTIONS));

    const track = useCallback((id: ActionMoveActionId, pressed: boolean): void => {
        setHeld((current: ActionHeldDirections) => setHeldDirection(current, id, pressed));
    }, []);

    useInputAction(keys.up, (event) => {
        track(keys.up, event.pressed);
    });
    useInputAction(keys.down, (event) => {
        track(keys.down, event.pressed);
    });
    useInputAction(keys.left, (event) => {
        track(keys.left, event.pressed);
    });
    useInputAction(keys.right, (event) => {
        track(keys.right, event.pressed);
    });

    useEffect(() => {
        const velocity = velocityFromHeld(held);
        const sent = sentVelocityRef.current;
        // The guard, not the dependency list, is what stops the duplicates: a
        // realtime snapshot arrives on every heartbeat, and every one of them
        // re-renders this screen while a key is held.
        if (velocity.dx === sent.dx && velocity.dy === sent.dy) return;

        sentVelocityRef.current = velocity;
        dispatch(ACTION_SET_VELOCITY_ACTION, { dx: velocity.dx, dy: velocity.dy }, seatId);
    }, [dispatch, held, seatId]);

    return null;
}

export default ActionPlayfield;
