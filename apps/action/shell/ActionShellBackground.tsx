'use client';

// The action app's shell background — the menu as a live 3D scene (§4.37.9).
//
// It mounts one `GameCanvas role="overlay"` holding the same three primitives
// and the same ground plane the match starts from, and it reacts to the shell
// around it in three ways:
//
//   1. YAW / DOLLY. `ActionShellCameraRig` reads the shell state per frame and
//      moves the camera: away onto bare ground while Settings is open, and in
//      toward the drafted primitive under the screen fade on the way into a
//      match. It publishes the phase it reached as data attributes on this
//      component's host element.
//   2. THE RINGS. Which primitive each local seat has picked is the F87 draft,
//      subscribed here — a ring is a render, unlike the camera, so this half
//      wants the re-render the camera half must not have.
//   3. THE CLICK. Under `shellBackgroundInteractive` the engine's layers stand
//      aside, so a click reaches the canvas: it moves the HOST seat's pick and
//      sounds the select blip.
//
// SHELL-STATE DISCIPLINE (Invariant #139). The only authoritative thing this
// writes is `setShellDraft`, the one field the game barrel publishes a setter
// for. No IPC, no tick, no `EngineAction` — clicking a primitive on the menu
// changes a draft and nothing else, and the match that reads it does not exist
// yet.
//
// The click is attributed to the HOST seat, always. The second seat's pick is
// the `/select` page's WASD cluster: a mouse has one pointer and no way to say
// which of two players is holding it.
//
// Module boundary: the renderer is reached only through its public barrels
// (Invariant #96) — here `components/r3f`, `audio` and `game`.

import React from 'react';
import { GameCanvas, type CameraConfig } from '@chimera-engine/renderer/components/r3f';
import { useSound } from '@chimera-engine/renderer/audio';
import { getShellState, setShellDraft, useShellState } from '@chimera-engine/renderer/game';

import { ActionGroundPlane } from '../components/ActionGroundPlane.js';
import { ActionPrimitiveMesh } from '../components/ActionPrimitiveMesh.js';
import { ActionSelectionRing } from '../components/ActionSelectionRing.js';
import { buildActionShellScene } from '../components/actionSceneModel.js';
import { actionShellAudioRefs } from '../shell-asset-manifest.js';
import { ACTION_SHELL_CAMERA_HOME, actionShellCameraView } from './actionShellCamera.js';
import { ActionShellCameraRig } from './ActionShellCameraRig.js';
import { readActionShellPicks, selectActionPick } from './actionShellSelection.js';
import styles from './ActionShellBackground.module.css';

/**
 * The scene, built ONCE at module scope.
 *
 * It is derived from the seed list and nothing else — no snapshot, no draft —
 * so rebuilding it per render would allocate a new object per frame of a
 * ring change for a value that cannot differ.
 */
const SHELL_SCENE = buildActionShellScene();

/**
 * The camera the canvas is CONSTRUCTED with — the home view, so the first
 * painted frame is already framed rather than snapping into place once the rig
 * runs. `GameCanvas` memoises the camera instance on this object's identity, so
 * it has to be a module constant: a fresh literal per render would rebuild the
 * camera every time a ring moved.
 */
const HOME_VIEW = actionShellCameraView(ACTION_SHELL_CAMERA_HOME, 0);

const SHELL_CAMERA: CameraConfig = {
    mode: 'perspective',
    position: HOME_VIEW.position,
    lookAt: HOME_VIEW.lookAt,
    fov: 45,
};

const AMBIENT_INTENSITY = 0.55;
const KEY_LIGHT_POSITION = [6, 12, 6] as const;
const KEY_LIGHT_INTENSITY = 1.1;

export function ActionShellBackground(): React.ReactElement {
    // Subscribed, not transient: a pick CHANGES what is rendered, so the
    // re-render is the point. The camera's own read is the transient one, and it
    // lives in the rig.
    const draft = useShellState((state) => state.draft);
    const picks = readActionShellPicks(draft);

    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const playSelect = useSound(actionShellAudioRefs.select);

    const focused = SHELL_SCENE.primitives.find((primitive) => primitive.shape === picks.host);
    const focusX = focused?.world[0] ?? 0;

    const handlePick = React.useCallback(
        (entityId: string): void => {
            const primitive = SHELL_SCENE.primitives.find((candidate) => candidate.id === entityId);
            if (primitive === undefined) {
                return;
            }
            // Read the draft TRANSIENTLY rather than closing over the subscribed
            // one: this callback is pinned to the blip, and a captured draft
            // would be the one from the render that built it — which, after the
            // page's own WASD pick, is already a version behind.
            const patch = selectActionPick(getShellState().draft, 'host', primitive.shape);
            if (patch === null) {
                // Refused by `selectActionPick`. Nothing changed, so nothing
                // sounds — a blip on a click that moved no ring reads as a bug.
                return;
            }
            setShellDraft(patch);
            playSelect();
        },
        [playSelect],
    );

    return (
        <div ref={hostRef} data-testid="action-shell-background" className={styles['host']}>
            <GameCanvas camera={SHELL_CAMERA} role="overlay">
                <ActionShellCameraRig hostRef={hostRef} focusX={focusX} />
                <ambientLight intensity={AMBIENT_INTENSITY} />
                <directionalLight
                    castShadow
                    intensity={KEY_LIGHT_INTENSITY}
                    position={KEY_LIGHT_POSITION}
                />
                {SHELL_SCENE.ground !== null && <ActionGroundPlane ground={SHELL_SCENE.ground} />}
                {SHELL_SCENE.primitives.map((primitive) => (
                    <React.Fragment key={primitive.id}>
                        <ActionPrimitiveMesh
                            primitive={primitive}
                            isControlled={picks.host === primitive.shape}
                            onSelect={handlePick}
                        />
                        {picks.host === primitive.shape && (
                            <ActionSelectionRing at={primitive.world} seat="host" />
                        )}
                        {picks.second === primitive.shape && (
                            <ActionSelectionRing at={primitive.world} seat="second" />
                        )}
                    </React.Fragment>
                ))}
            </GameCanvas>
        </div>
    );
}
