'use client';

/**
 * renderer/components/lobby/ProfileRejectedToastBridge.tsx (§4.30).
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

import { useEffect, useRef } from 'react';
import type { ProfileRejection } from '@chimera-engine/simulation/bridge/api-types.js';
import { getLobbyBridge } from '../../app/lobby/useLobbyApi';
import { TOAST_KEYS } from '../../i18n/engine-keys';
import type { TranslateFn } from '../../i18n/i18n-context';
import { useTranslate } from '../../i18n/useTranslate';
import type { TranslationKey } from '../../i18n/translation-bundle';
import { useToastStore } from '../../state/toastStore';

/** Friendly-copy translation token for each raw gate code; unknown codes fall
 * back to the raw reason string (matching the prior `?? reason`). */
const FRIENDLY_REASON_KEYS: Readonly<Record<string, TranslationKey>> = {
    'profile:DISPLAY_NAME_EMPTY': TOAST_KEYS.profileDisplayNameEmpty,
    'profile:DISPLAY_NAME_TOO_LONG': TOAST_KEYS.profileDisplayNameTooLong,
    'profile:AVATAR_INVALID_MIME': TOAST_KEYS.profileAvatarInvalidMime,
    'profile:AVATAR_TOO_LARGE': TOAST_KEYS.profileAvatarTooLarge,
    'profile:AVATAR_DECODE_FAILED': TOAST_KEYS.profileAvatarDecodeFailed,
    'profile:SCHEMA_MISMATCH': TOAST_KEYS.profileSchemaMismatch,
    'profile:NAMESPACE_COLLISION': TOAST_KEYS.profileNamespaceCollision,
    rate_limit: TOAST_KEYS.profileRateLimit,
};

function friendlyReason(t: TranslateFn, reason: string): string {
    const key = FRIENDLY_REASON_KEYS[reason];
    return key !== undefined ? t(key) : reason;
}

export function ProfileRejectedToastBridge(): null {
    // The subscription is one-time (empty deps) so a locale change must not
    // re-subscribe and drop events; read the latest translator through a ref
    // instead. A resolved token is still a static title (Invariant #74).
    const t = useTranslate();
    const tRef = useRef(t);
    tRef.current = t;

    useEffect(() => {
        // Guard: outside Electron (or before preload wiring) there is no bridge.
        const bridge = getLobbyBridge();
        if (bridge === null) {
            return;
        }
        return bridge.lobby.onProfileRejected((rejection: ProfileRejection) => {
            const translate = tRef.current;
            useToastStore.getState().push({
                severity: 'error',
                title: translate(TOAST_KEYS.profileRejectedPrefix, {
                    reason: friendlyReason(translate, rejection.reason),
                }),
            });
        });
    }, []);

    return null;
}
