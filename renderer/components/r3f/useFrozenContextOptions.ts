'use client';

/**
 * renderer/components/r3f/useFrozenContextOptions.ts
 *
 * Freezes `<GameCanvas>`'s `contextOptions` at mount, and refuses a later
 * change observably (§4.22).
 *
 * WebGL context attributes are fixed when the context is built. Unlike the
 * mutable knobs there is no route that corrects one afterwards — not even from
 * inside the canvas, since `useThree(s => s.gl)` reaches the renderer rather
 * than its construction parameters. A value written after mount can therefore
 * only be ignored, and ignoring it SILENTLY is the failure this module exists
 * to prevent: the author sees a prop they set and a canvas that disregards it.
 *
 * So the mount value is what the canvas keeps, and the differing keys are
 * named through the renderer logger — logged, not thrown, per the
 * `DuplicateMainGameCanvasError` and `FrameloopWiringError` conventions
 * (FrameRateLimiter.tsx's header records why a canvas-adjacent failure must
 * not throw).
 *
 * The comparison is by VALUE, not by object identity: a game writing its
 * options inline passes a fresh object on every render, and refusing that
 * would report a change no author made.
 *
 * The report is NOT deferred a frame, unlike `mainCanvasRegistry`'s. That one
 * waits because a screen transition legitimately overlaps two `role="main"`
 * canvases for a frame, so only a pair still concurrent when the frame fires
 * is a real duplicate. A `contextOptions` object that differs from the mount
 * value has no such transient: it is already the final answer at the commit
 * that produced it.
 *
 * Not exported from the r3f barrel.
 */

import React from 'react';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';
import { WEBGL_CONTEXT_OPTION_KEYS } from './rendererConfig.js';
import type { WebGLContextOptions } from './rendererConfig.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'game-canvas';

/** Names the keys a game rewrote after the WebGL context was already built. */
class ContextOptionsAfterMountError extends Error {
    constructor(changedKeys: readonly string[]) {
        super(
            `contextOptions changed after mount (${changedKeys.join(', ')}), and WebGL ` +
                `context attributes are fixed when the context is built — the canvas keeps ` +
                `the values it mounted with. Author these once, or remount the canvas with ` +
                `a new key to build a context with the new attributes.`,
        );
        this.name = 'ContextOptionsAfterMountError';
    }
}

/**
 * The context options this canvas was mounted with, whatever later renders
 * pass. A later value that differs from the mount is reported once per
 * TRANSITION into it — repeating the same rejected value across renders is
 * quiet, but leaving it and returning reports again — from an effect, so the
 * report never lands inside the render that noticed it.
 */
export function useFrozenContextOptions(
    options: WebGLContextOptions | undefined,
): WebGLContextOptions | undefined {
    const frozenRef = React.useRef<WebGLContextOptions | undefined>(undefined);
    const initializedRef = React.useRef(false);
    // The value the PREVIOUS render authored. Reporting is keyed on the
    // transition into a rejected value, not on the set of rejected values seen
    // so far: a game that returns to the mounted value and moves away again
    // has made two changes that cannot take effect, and swallowing the second
    // is the silent-ignore this hook exists to prevent.
    const lastSeenRef = React.useRef<WebGLContextOptions | undefined>(undefined);

    if (!initializedRef.current) {
        initializedRef.current = true;
        frozenRef.current = options;
        // Seeding lastSeen here is not observable — on the first render
        // `frozen` and `options` are the same reference, so the effect's first
        // guard returns before the second is consulted, and by the next render
        // the effect has written it. It stays so the ref's invariant ("the
        // options the previous render authored") holds from the first render
        // rather than from the first commit; a reader who assumes that of a
        // later-added branch would otherwise be wrong.
        lastSeenRef.current = options;
    }

    const frozen = frozenRef.current;
    const changedKeys = changedOptionKeys(frozen, options);
    const unchangedSinceLastRender = changedOptionKeys(lastSeenRef.current, options).length === 0;

    React.useEffect(() => {
        lastSeenRef.current = options;
        // Two independent guards. The first keeps a render that returned to
        // the MOUNT value quiet — without it the report fires with an empty
        // key list, naming no key at all. The second keeps a render that
        // merely repeated the rejected value quiet.
        if (changedKeys.length === 0 || unchangedSinceLastRender) {
            return;
        }
        emitRendererError(
            readRendererLogsApi(),
            '[GameCanvas] contextOptions changed after the WebGL context was built',
            new ContextOptionsAfterMountError(changedKeys),
            { changedKeys },
            LOG_MODULE,
        );
    });

    return frozen;
}

/**
 * The option keys whose values differ between two authored objects. A key
 * DROPPED from the later object counts: `{}` asks for r3f's default where the
 * mount asked for something else, and the context cannot be rebuilt either way.
 */
function changedOptionKeys(
    mounted: WebGLContextOptions | undefined,
    current: WebGLContextOptions | undefined,
): readonly string[] {
    if (mounted === undefined && current === undefined) {
        return [];
    }

    return WEBGL_CONTEXT_OPTION_KEYS.filter((key) => mounted?.[key] !== current?.[key]);
}
