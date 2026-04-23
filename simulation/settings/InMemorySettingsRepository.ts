import type { UserSettings } from './SettingsSchema';
import type { SettingsRepository } from './SettingsRepository';

/**
 * In-memory implementation of SettingsRepository for use in unit tests and
 * development environments.  State is not persisted across instances.
 */
export class InMemorySettingsRepository implements SettingsRepository {
    private readonly store = new Map<string, UserSettings>();

    load(gameId: string): Promise<UserSettings> {
        const stored = this.store.get(gameId);
        if (stored === undefined) {
            return Promise.resolve({});
        }
        return Promise.resolve(JSON.parse(JSON.stringify(stored)) as UserSettings);
    }

    save(gameId: string, overrides: UserSettings): Promise<void> {
        this.store.set(gameId, JSON.parse(JSON.stringify(overrides)) as UserSettings);
        return Promise.resolve();
    }

    reset(gameId: string): Promise<void> {
        this.store.delete(gameId);
        return Promise.resolve();
    }
}
