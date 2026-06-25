// renderer/state/confirmActiveProfile.ts
//
// Post-IPC-ACK helper that refreshes profileStore.localProfileId from the
// main-process-confirmed profile.  Lives in `renderer/state/` so that the
// `setLocalProfileId` store mutation (marked "ipcClient only") is called from
// the state layer, not from a component-side file.
//
// Usage: call after a successful `profile.updateLocal(patch)` to drive the
// store update from the confirmed main-process state rather than optimistically.

import type { ProfileAPI } from '@chimera/simulation/bridge/api-types.js';
import { useProfileStore } from './profileStore';

/**
 * Reads the acknowledged profile back from main via `getLocalProfile()` and
 * writes the confirmed `localProfileId` into `profileStore`.
 *
 * Mirrors the flow used by `profileStoreBootstrap` on initial load.
 */
export async function confirmActiveProfile(
    api: Pick<ProfileAPI, 'getLocalProfile'>,
): Promise<void> {
    const confirmed = await api.getLocalProfile();
    useProfileStore.getState().setLocalProfileId(confirmed.localProfileId);
}
