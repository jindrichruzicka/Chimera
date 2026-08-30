'use client';

// The action app's match screen — the engine's first realtime playfield.
//
// Three things happen here and nowhere else in this app:
//
//   1. The arena is MOUNTED: one `GameCanvas role="main"` on the `top-down`
//      preset, the ground plane, and one mesh per primitive, all read off the
//      projected snapshot through `parseActionScene`.
//   2. Arrow keys become VELOCITY. The input layer dispatches on key down AND
//      key up, so a held key is one press event and one release event — the
//      screen keeps the set of held directions and derives one velocity from
//      it (`components/actionVelocityInput.ts`).
//   3. A click on a primitive becomes `action:select-primitive`.
//
// What is deliberately NOT here: per-frame dispatch. `action:set-velocity` is
// sent only when the derived velocity CHANGES, so holding a key costs one
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

import {
    ACTION_SELECT_PRIMITIVE_ACTION,
    ACTION_SET_VELOCITY_ACTION,
} from '../simulation/constants.js';
import {
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_MOVE_UP_ACTION,
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
import styles from './ActionPlayfield.module.css';

const AMBIENT_INTENSITY = 0.6;
const KEY_LIGHT_POSITION = [6, 12, 6] as const;
const KEY_LIGHT_INTENSITY = 1.1;

export function ActionPlayfield({
    snapshot,
    localPlayerId,
    sendAction,
}: GameScreenProps): React.ReactElement {
    const scene = parseActionScene(snapshot.entities);
    const viewerId = localPlayerId ?? snapshot.viewerId;

    const [held, setHeld] = useState(NO_HELD_DIRECTIONS);

    // The last velocity actually dispatched. A ref rather than state: it is
    // read to decide whether to dispatch at all, and re-rendering on it would
    // just re-run the same comparison against the same value.
    const sentVelocityRef = useRef(velocityFromHeld(NO_HELD_DIRECTIONS));

    // Everything `dispatch` needs, held in REFS and re-pointed on every render.
    //
    // Refs rather than closed-over values because `dispatch` itself is pinned to
    // `[]`: the primitive meshes hold it across renders, and re-creating it per
    // render would re-fire the effect below on every heartbeat. Anything
    // captured directly would therefore be frozen at the render that built the
    // closure — and at this heartbeat that staleness is not subtle. A primitive
    // clicked a second after the match started would stamp its action with a
    // tick ten beats old.
    const sendActionRef = useRef(sendAction);
    sendActionRef.current = sendAction;
    const tickRef = useRef(snapshot.tick);
    tickRef.current = snapshot.tick;
    const viewerIdRef = useRef(viewerId);
    viewerIdRef.current = viewerId;

    /** Sends one action for this viewer, stamped with the CURRENT tick. */
    const dispatch = useCallback((type: string, payload: Record<string, unknown>): void => {
        sendActionRef.current({
            type,
            playerId: viewerIdRef.current,
            tick: tickRef.current,
            payload,
        });
    }, []);

    useEffect(() => {
        const velocity = velocityFromHeld(held);
        const sent = sentVelocityRef.current;
        // The guard, not the dependency list, is what stops the duplicates: a
        // realtime snapshot arrives on every heartbeat, and every one of them
        // re-renders this screen while a key is held.
        if (velocity.dx === sent.dx && velocity.dy === sent.dy) return;

        sentVelocityRef.current = velocity;
        dispatch(ACTION_SET_VELOCITY_ACTION, { dx: velocity.dx, dy: velocity.dy });
    }, [dispatch, held]);

    const handleSelect = useCallback(
        (entityId: string): void => {
            dispatch(ACTION_SELECT_PRIMITIVE_ACTION, { entityId });
        },
        [dispatch],
    );

    return (
        <div className={styles['sceneHost']}>
            <ActionMovementKeys onChange={setHeld} />
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
            <p className={styles['hint']}>Arrow keys move · click a primitive to take it</p>
        </div>
    );
}

/**
 * Subscribes the four movement actions and folds each press/release into the
 * held set.
 *
 * A separate component because `useInputAction` is one subscription per call
 * and the ids must be listed statically — a loop over the id list inside the
 * parent would break the rules of hooks. It renders nothing; mounting it IS the subscription. The list below is
 * pinned against `ACTION_MOVE_ACTION_IDS` by the screen's test, so an id added
 * there without a hook here is caught rather than silently unsubscribed.
 */
function ActionMovementKeys({
    onChange,
}: {
    readonly onChange: React.Dispatch<React.SetStateAction<ActionHeldDirections>>;
}): null {
    const track = useCallback(
        (id: ActionMoveActionId, pressed: boolean): void => {
            onChange((current) => setHeldDirection(current, id, pressed));
        },
        [onChange],
    );

    useInputAction(ACTION_MOVE_UP_ACTION, (event) => {
        track(ACTION_MOVE_UP_ACTION, event.pressed);
    });
    useInputAction(ACTION_MOVE_DOWN_ACTION, (event) => {
        track(ACTION_MOVE_DOWN_ACTION, event.pressed);
    });
    useInputAction(ACTION_MOVE_LEFT_ACTION, (event) => {
        track(ACTION_MOVE_LEFT_ACTION, event.pressed);
    });
    useInputAction(ACTION_MOVE_RIGHT_ACTION, (event) => {
        track(ACTION_MOVE_RIGHT_ACTION, event.pressed);
    });

    return null;
}

export default ActionPlayfield;
