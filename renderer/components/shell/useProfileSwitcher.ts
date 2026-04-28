// renderer/components/shell/useProfileSwitcher.ts
//
// Hook providing pass-and-play profile slot loading and switching.
// Reads available local profile slots via window.__chimera.profile.listLocalSlots()
// and calls window.__chimera.profile.switchLocalSlot() to switch the active seat.
//
// Invariant #62: profile data is read from profileStore, never from PlayerSnapshot.
// Invariant #59: profile data is never written to GameSnapshot or SaveFile.

import { useEffect, useMemo, useState } from 'react';
import type { LocalProfileSlot, LogsAPI, ProfileAPI } from '@chimera/electron/preload/api-types.js';
import type { LogEntry, LogErrorInfo } from '@chimera/shared/logging.js';
import { confirmActiveProfile } from '../../state/confirmActiveProfile';

export type { LocalProfileSlot };

export interface ProfileSwitcherApi {
    /** Available local profile slots on this machine. Empty until loaded. */
    readonly slots: readonly LocalProfileSlot[];
    /**
     * Switch the active local profile to the given slot.
     * Calls profile.switchLocalSlot(localProfileId), waits for the IPC ACK,
     * then refreshes profileStore.localProfileId from getLocalProfile() —
     * driven by the confirmed main-process state, not an optimistic write.
     */
    readonly switchToProfile: (localProfileId: string) => Promise<void>;
}

export interface ProfileSwitcherBridge {
    readonly profile: Pick<ProfileAPI, 'listLocalSlots' | 'switchLocalSlot' | 'getLocalProfile'>;
    readonly logs: Pick<LogsAPI, 'emit'>;
}

interface BridgeSource {
    readonly __chimera?: {
        readonly profile?: Pick<
            ProfileAPI,
            'listLocalSlots' | 'switchLocalSlot' | 'getLocalProfile'
        >;
        readonly logs?: Pick<LogsAPI, 'emit'>;
    };
}

function now(): number {
    return Date.now();
}

function toErrorInfo(error: unknown): LogErrorInfo {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            ...(error.stack !== undefined && { stack: error.stack }),
        };
    }
    return { name: 'UnknownError', message: String(error) };
}

function makeSlotLoadFailureEntry(error: unknown): LogEntry {
    return {
        level: 'error',
        message: 'Failed to load local profile slots',
        timestamp: now(),
        source: { process: 'renderer', module: 'profile-switcher' },
        error: toErrorInfo(error),
    };
}

function makeSwitchFailureEntry(localProfileId: string, error: unknown): LogEntry {
    return {
        level: 'error',
        message: 'Failed to switch active profile',
        timestamp: now(),
        source: { process: 'renderer', module: 'profile-switcher' },
        context: { localProfileId },
        error: toErrorInfo(error),
    };
}

export function getProfileSwitcherBridge(
    source: unknown = globalThis,
): ProfileSwitcherBridge | null {
    const s = source as BridgeSource;
    if (!s.__chimera?.profile || !s.__chimera.logs) {
        return null;
    }
    return { profile: s.__chimera.profile, logs: s.__chimera.logs };
}

export function useProfileSwitcher(): ProfileSwitcherApi {
    const [slots, setSlots] = useState<readonly LocalProfileSlot[]>([]);

    useEffect(() => {
        const bridge = getProfileSwitcherBridge();
        if (bridge === null) {
            return;
        }

        let cancelled = false;

        void bridge.profile
            .listLocalSlots()
            .then((loaded) => {
                if (!cancelled) {
                    setSlots(loaded);
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    bridge.logs.emit(makeSlotLoadFailureEntry(error));
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return useMemo(
        () => ({
            slots,
            async switchToProfile(localProfileId: string): Promise<void> {
                const bridge = getProfileSwitcherBridge();
                if (bridge === null) {
                    return;
                }

                try {
                    await bridge.profile.switchLocalSlot(localProfileId);
                    // Drive the store update from the IPC-confirmed state via
                    // confirmActiveProfile() — which lives in renderer/state/ and
                    // is the approved caller of setLocalProfileId (§ "ipcClient only").
                    await confirmActiveProfile(bridge.profile);
                } catch (error: unknown) {
                    bridge.logs.emit(makeSwitchFailureEntry(localProfileId, error));
                }
            },
        }),
        [slots],
    );
}
