/**
 * electron/main/replay/exportMatchReplays.test.ts
 *
 * Unit tests for `exportPerspectiveWithDeterministicCoSave` — the post-game save
 * helper that always persists the player's OWN perspective replay and, only in a
 * non-packaged (dev/e2e) build with an active deterministic recording, co-saves
 * the deterministic debug copy alongside it.
 *
 * Tests written first (RED before implementation). The deterministic replay
 * reconstructs full global state (every seat's hidden info), so it is a dev-only
 * debug artifact: it must never be written in a packaged production build
 * (privacy — Invariants #71 / #98).
 */

import { describe, expect, it, vi } from 'vitest';
import { exportPerspectiveWithDeterministicCoSave } from './exportMatchReplays.js';

function makeDeps(options: {
    readonly isPackaged: boolean;
    readonly deterministicRecording: boolean;
    readonly perspectivePath?: string;
    readonly deterministicPath?: string;
}): {
    readonly deps: Parameters<typeof exportPerspectiveWithDeterministicCoSave>[0];
    readonly perspectiveExport: ReturnType<typeof vi.fn>;
    readonly deterministicExport: ReturnType<typeof vi.fn>;
} {
    const perspectiveExport = vi.fn(() =>
        Promise.resolve(options.perspectivePath ?? '/perspective/p.chimera-perspective-replay'),
    );
    const deterministicExport = vi.fn(() =>
        Promise.resolve(options.deterministicPath ?? '/deterministic/d.chimera-replay'),
    );
    return {
        deps: {
            perspective: { exportCurrent: perspectiveExport },
            deterministic: {
                isRecording: () => options.deterministicRecording,
                exportCurrentMatch: deterministicExport,
            },
            isPackaged: options.isPackaged,
        },
        perspectiveExport,
        deterministicExport,
    };
}

describe('exportPerspectiveWithDeterministicCoSave', () => {
    it('always exports the perspective replay and returns its path', async () => {
        const { deps, perspectiveExport } = makeDeps({
            isPackaged: false,
            deterministicRecording: true,
            perspectivePath: '/perspective/mine.chimera-perspective-replay',
        });

        const result = await exportPerspectiveWithDeterministicCoSave(deps);

        expect(perspectiveExport).toHaveBeenCalledTimes(1);
        expect(result).toBe('/perspective/mine.chimera-perspective-replay');
    });

    it('co-saves the deterministic debug copy in a dev build with an active recording (a host)', async () => {
        const { deps, deterministicExport } = makeDeps({
            isPackaged: false,
            deterministicRecording: true,
        });

        await exportPerspectiveWithDeterministicCoSave(deps);

        expect(deterministicExport).toHaveBeenCalledTimes(1);
    });

    it('does NOT co-save the deterministic replay in a packaged build (privacy)', async () => {
        const { deps, perspectiveExport, deterministicExport } = makeDeps({
            isPackaged: true,
            // Even if a deterministic recording somehow existed, packaged never writes it.
            deterministicRecording: true,
        });

        await exportPerspectiveWithDeterministicCoSave(deps);

        expect(perspectiveExport).toHaveBeenCalledTimes(1);
        expect(deterministicExport).not.toHaveBeenCalled();
    });

    it('does NOT co-save when no deterministic recording is active (a joined client)', async () => {
        const { deps, perspectiveExport, deterministicExport } = makeDeps({
            isPackaged: false,
            deterministicRecording: false,
        });

        await exportPerspectiveWithDeterministicCoSave(deps);

        expect(perspectiveExport).toHaveBeenCalledTimes(1);
        expect(deterministicExport).not.toHaveBeenCalled();
    });

    it('propagates the user-entered name to BOTH exports on the co-save path', async () => {
        const { deps, perspectiveExport, deterministicExport } = makeDeps({
            isPackaged: false,
            deterministicRecording: true,
        });

        await exportPerspectiveWithDeterministicCoSave(deps, 'Grand Finale');

        expect(perspectiveExport).toHaveBeenCalledWith('Grand Finale');
        expect(deterministicExport).toHaveBeenCalledWith('Grand Finale');
    });

    it('returns the perspective path even when the deterministic co-save resolves a different path', async () => {
        const { deps } = makeDeps({
            isPackaged: false,
            deterministicRecording: true,
            perspectivePath: '/perspective/keep.chimera-perspective-replay',
            deterministicPath: '/deterministic/ignore.chimera-replay',
        });

        const result = await exportPerspectiveWithDeterministicCoSave(deps);

        expect(result).toBe('/perspective/keep.chimera-perspective-replay');
    });

    it('swallows a failing deterministic co-save — the perspective save still succeeds', async () => {
        // The user's perspective replay is already on disk when the dev-only
        // deterministic co-save runs; a co-save failure (disk full / EIO) must NOT
        // fail the user-facing save. It is reported via onCoSaveError and swallowed.
        const perspectiveExport = vi.fn(() =>
            Promise.resolve('/perspective/mine.chimera-perspective-replay'),
        );
        const coSaveError = new Error('disk full');
        const deterministicExport = vi.fn(() => Promise.reject(coSaveError));
        const onCoSaveError = vi.fn();

        const result = await exportPerspectiveWithDeterministicCoSave(
            {
                perspective: { exportCurrent: perspectiveExport },
                deterministic: { isRecording: () => true, exportCurrentMatch: deterministicExport },
                isPackaged: false,
                onCoSaveError,
            },
            'Grand Finale',
        );

        expect(result).toBe('/perspective/mine.chimera-perspective-replay');
        expect(deterministicExport).toHaveBeenCalledTimes(1);
        expect(onCoSaveError).toHaveBeenCalledTimes(1);
        expect(onCoSaveError).toHaveBeenCalledWith(coSaveError);
    });

    it('does not invoke onCoSaveError when the co-save succeeds', async () => {
        const { deps } = makeDeps({ isPackaged: false, deterministicRecording: true });
        const onCoSaveError = vi.fn();

        await exportPerspectiveWithDeterministicCoSave({ ...deps, onCoSaveError });

        expect(onCoSaveError).not.toHaveBeenCalled();
    });
});
