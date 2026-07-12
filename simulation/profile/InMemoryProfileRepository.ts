/**
 * simulation/profile/InMemoryProfileRepository.ts
 *
 * In-memory implementation of ProfileRepository.
 * Used in unit tests and headless scenarios where filesystem persistence is
 * not required.
 *
 * Architecture: §4.24 — Player Profiles & Directory
 *
 * Invariants upheld:
 *   #2  — zero imports from renderer/, electron/, games/*, or DOM APIs
 *   #60 — ProfileRepository persists only the local machine's profiles;
 *          this is the in-memory variant used for testing.
 */

import type { LocalProfileId, PlayerProfile, ProfileRepository } from './ProfileSchema.js';

/**
 * In-memory implementation of {@link ProfileRepository}.
 *
 * Stores profiles in a `Map<string, PlayerProfile>`.  All methods return
 * resolved `Promise`s to maintain API parity with `FileProfileRepository`.
 * Each `load` returns a shallow copy of the stored profile so callers cannot
 * mutate internal state through the returned reference.
 */
export class InMemoryProfileRepository implements ProfileRepository {
    private readonly store = new Map<string, PlayerProfile>();

    load(id: LocalProfileId): Promise<PlayerProfile | null> {
        const profile = this.store.get(id);
        if (profile === undefined) {
            return Promise.resolve(null);
        }
        // Return a defensive copy to prevent callers from mutating stored state.
        return Promise.resolve({ ...profile });
    }

    save(profile: PlayerProfile): Promise<void> {
        this.store.set(profile.localProfileId, { ...profile });
        return Promise.resolve();
    }

    listLocalSlots(): Promise<
        readonly { readonly localProfileId: LocalProfileId; readonly displayName: string }[]
    > {
        const slots = Array.from(this.store.values()).map((p) => ({
            localProfileId: p.localProfileId,
            displayName: p.displayName,
        }));
        return Promise.resolve(slots);
    }

    delete(id: LocalProfileId): Promise<void> {
        this.store.delete(id);
        return Promise.resolve();
    }
}
