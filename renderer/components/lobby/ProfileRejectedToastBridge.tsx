'use client';

/**
 * renderer/components/lobby/ProfileRejectedToastBridge.tsx (§4.30, #688).
 *
 * App-wide listener that turns a main-process profile-admission rejection into a
 * "Profile rejected: {reason}" error toast. Main pushes
 * `chimera:lobby:profile-rejected` for both the JOIN-time rejection and a
 * mid-session PROFILE_UPDATE rejection; this bridge — a renderer module allowed
 * to use `toastStore` — maps the structured gate code to friendly copy and
 * raises the toast.
 *
 * The reason originates from the `ProfileGate`/`ProfileSanitizer` admission path
 * (Invariants #61/#62) — a connection/session signal, never derived from
 * `GameSnapshot`/`PlayerSnapshot`/`SaveFile` (Invariant #74). Duration is the
 * severity default. Mounted once in `AppShell`; renders nothing.
 */

import { useEffect } from 'react';
import type { ProfileRejection } from '@chimera-engine/simulation/bridge/api-types.js';
import { getLobbyBridge } from '../../app/lobby/useLobbyApi';
import { useToastStore } from '../../state/toastStore';

/** Friendly copy for each raw gate code; falls back to the raw reason. */
const FRIENDLY_REASON: Readonly<Record<string, string>> = {
    'profile:DISPLAY_NAME_EMPTY': 'display name is required',
    'profile:DISPLAY_NAME_TOO_LONG': 'display name is too long',
    'profile:AVATAR_INVALID_MIME': 'avatar image type is not supported',
    'profile:AVATAR_TOO_LARGE': 'avatar image is too large',
    'profile:AVATAR_DECODE_FAILED': 'avatar image could not be read',
    'profile:SCHEMA_MISMATCH': 'profile data is invalid',
    'profile:NAMESPACE_COLLISION': 'that profile is already in use',
    rate_limit: 'updating too quickly',
};

function friendlyReason(reason: string): string {
    return FRIENDLY_REASON[reason] ?? reason;
}

export function ProfileRejectedToastBridge(): null {
    useEffect(() => {
        // Guard: outside Electron (or before preload wiring) there is no bridge.
        const bridge = getLobbyBridge();
        if (bridge === null) {
            return;
        }
        return bridge.lobby.onProfileRejected((rejection: ProfileRejection) => {
            useToastStore.getState().push({
                severity: 'error',
                title: `Profile rejected: ${friendlyReason(rejection.reason)}`,
            });
        });
    }, []);

    return null;
}
