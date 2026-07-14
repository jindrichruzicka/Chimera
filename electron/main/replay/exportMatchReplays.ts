/**
 * electron/main/replay/exportMatchReplays.ts
 *
 * Post-game save orchestration for the replay player's compact save icon (§4.28).
 *
 * A single press persists the player's OWN **perspective** replay — the
 * privacy-safe, already fog-filtered record of what one seat saw (Invariant #98).
 * The **deterministic** replay reconstructs the full global state from
 * `seed + actions` (every seat's hidden info — e.g. an opponent's whole deck in a
 * CCG), so it is a dev-only debug artifact: co-saved alongside the perspective in
 * a non-packaged build, and NEVER written in a packaged production build.
 *
 * The decision lives entirely in the trusted main process (keyed on
 * `app.isPackaged`), so the renderer stays build-agnostic. Extracted here as a
 * pure, dependency-injected function so the co-save policy is unit-testable
 * without the whole Electron composition root.
 */

/** The perspective-replay slice this helper drives (privacy-safe, always saved). */
export interface PerspectiveExportPort {
    /** Finalise the in-progress perspective recording, resolving with its path. */
    exportCurrent(name?: string): Promise<string>;
}

/** The deterministic-replay slice this helper co-saves in non-packaged builds. */
export interface DeterministicExportPort {
    /** Whether a deterministic match recording is currently in progress. */
    isRecording(): boolean;
    /** Finalise the in-progress deterministic recording, resolving with its path. */
    exportCurrentMatch(name?: string): Promise<string>;
}

export interface ExportMatchReplayDeps {
    readonly perspective: PerspectiveExportPort;
    readonly deterministic: DeterministicExportPort;
    /** `app.isPackaged` — the sole trusted build signal for the privacy gate. */
    readonly isPackaged: boolean;
    /**
     * Best-effort hook invoked if the dev-only deterministic co-save throws. By the
     * time it runs the user's perspective replay is already persisted, so a failed
     * debug co-save must NOT fail the overall save — the error is reported here and
     * swallowed (logged by the caller, never surfaced to the renderer).
     */
    readonly onCoSaveError?: (error: unknown) => void;
}

/**
 * Save the just-finished match: always the player's perspective replay, plus the
 * deterministic debug copy only in a non-packaged build that is actively recording
 * one.
 *
 * @param deps injected replay ports + the packaged build signal.
 * @param name optional user-entered replay name, stamped onto both saved files.
 * @returns the perspective replay path (the deterministic co-save path is a
 *   dev-only side effect and is deliberately not surfaced to the caller).
 */
export async function exportPerspectiveWithDeterministicCoSave(
    deps: ExportMatchReplayDeps,
    name?: string,
): Promise<string> {
    const perspectivePath = await deps.perspective.exportCurrent(name);
    // Deterministic replays reconstruct full global state (every seat's hidden
    // info), so they are a dev-only debug artifact: co-saved alongside the
    // player's own perspective in non-packaged builds, NEVER in a packaged build.
    if (!deps.isPackaged && deps.deterministic.isRecording()) {
        try {
            await deps.deterministic.exportCurrentMatch(name);
        } catch (error: unknown) {
            // The perspective replay (the user's artifact) is already on disk; the
            // deterministic copy is a best-effort dev debug side effect, so its
            // failure must not fail — or even be visible to — the user-facing save.
            deps.onCoSaveError?.(error);
        }
    }
    return perspectivePath;
}
