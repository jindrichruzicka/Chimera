'use client';

// The shell background's camera loop: the one place that reads the live shell
// state per frame and moves the camera with it (§4.37.18).
//
// TRANSIENT reads, never a subscription. `getShellState()` is plain data and
// takes no store subscription, so this reads the surface and the armed
// transition on every frame without re-rendering anything — which is exactly
// what a subscription here would do, at frame rate, to a subtree holding a
// canvas.
//
// It writes the pose it reached back onto the HOST ELEMENT as two data
// attributes rather than exposing it as React state. Two reasons, and both
// matter: state would re-render the canvas subtree sixty times a second, and a
// WebGL camera transform is not observable from the DOM at all — while a CSS
// transition, the other thing a reader might watch, is frozen under
// Playwright-Electron and proves nothing about a camera that is actually
// moving. The attributes name the PHASE (`home`/`moving`/`away`), so a reader
// waits on an arrival rather than sampling a number.
//
// Shell-state discipline (Invariant #139): this reads and reacts, and does
// nothing else. No IPC, no tick, no `EngineAction` — the only thing it writes
// is a camera transform and two attributes on its own host element.

import { useFrame, useThree } from '@react-three/fiber';
import React from 'react';
import { getShellState } from '@chimera-engine/renderer/game';

import {
    ACTION_SHELL_CAMERA_HOME,
    ACTION_SHELL_DOLLY_RETURN_MS,
    actionShellCameraView,
    advanceActionShellPose,
    describeActionShellDolly,
    describeActionShellYaw,
    resolveActionShellCameraTarget,
    type ActionShellCameraPose,
} from './actionShellCamera.js';

/** The attribute naming which end of the yaw the camera is at. */
export const ACTION_SHELL_YAW_ATTRIBUTE = 'data-action-shell-yaw';
/** The attribute naming which end of the dolly the camera is at. */
export const ACTION_SHELL_DOLLY_ATTRIBUTE = 'data-action-shell-dolly';

export interface ActionShellCameraRigProps {
    /**
     * The background's own host element — where the pose is published. A ref
     * rather than a callback prop because the write happens inside `useFrame`,
     * and a prop callback would drag the parent into the frame loop.
     */
    readonly hostRef: React.RefObject<HTMLElement | null>;
    /** Arena X of the primitive the draft names: the cell the dolly drives to. */
    readonly focusX: number;
}

export function ActionShellCameraRig({
    hostRef,
    focusX,
}: ActionShellCameraRigProps): React.ReactElement | null {
    const camera = useThree((state) => state.camera);

    const poseRef = React.useRef<ActionShellCameraPose>(ACTION_SHELL_CAMERA_HOME);
    // The focus, re-pointed on every render rather than closed over: the frame
    // callback below is registered once, and a captured value would keep
    // dollying toward whichever primitive was picked when it was registered.
    const focusRef = React.useRef(focusX);
    focusRef.current = focusX;

    // Publish the opening pose BEFORE the first frame. Without it the host
    // carries no phase at all until a frame runs, and a reader arriving in that
    // window cannot tell "at home" from "not published yet".
    React.useLayoutEffect(() => {
        writePose(hostRef.current, ACTION_SHELL_CAMERA_HOME);
    }, [hostRef]);

    useFrame((_state, delta) => {
        const shell = getShellState();
        const entering = shell.transition?.kind === 'to-match';
        const target = resolveActionShellCameraTarget({
            isSettings: shell.surface === 'settings',
            isEnteringMatch: entering,
        });
        // The engine's own screen fade on the way in — the transition carries the
        // duration precisely so a background moves on the same clock — and this
        // background's own return leg on the way back, where there is no armed
        // transition left to read one from.
        const dollyMs = entering
            ? (shell.transition?.durationMs ?? ACTION_SHELL_DOLLY_RETURN_MS)
            : ACTION_SHELL_DOLLY_RETURN_MS;

        const next = advanceActionShellPose(poseRef.current, target, delta, dollyMs);

        // Applied every frame even when the pose did not move: the FOCUS may
        // have, and a camera that only re-placed itself on a pose change would
        // stay framed on the primitive that was picked before the last click.
        const view = actionShellCameraView(next, focusRef.current);
        camera.position.set(view.position[0], view.position[1], view.position[2]);
        camera.lookAt(view.lookAt[0], view.lookAt[1], view.lookAt[2]);

        if (next !== poseRef.current) {
            poseRef.current = next;
            writePose(hostRef.current, next);
        }
    });

    return null;
}

/**
 * Publish the pose as the two phase attributes.
 *
 * Only the PHASE is written, so a running ramp costs two attribute writes at
 * each end rather than two per frame — and the attribute stays a fact a reader
 * can wait on instead of a number it would have to sample.
 */
function writePose(host: HTMLElement | null, pose: ActionShellCameraPose): void {
    if (host === null) {
        return;
    }
    const yaw = describeActionShellYaw(pose.yaw);
    const dolly = describeActionShellDolly(pose.dolly);
    if (host.getAttribute(ACTION_SHELL_YAW_ATTRIBUTE) !== yaw) {
        host.setAttribute(ACTION_SHELL_YAW_ATTRIBUTE, yaw);
    }
    if (host.getAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE) !== dolly) {
        host.setAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE, dolly);
    }
}
