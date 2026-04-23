import type { UserSettings } from './SettingsSchema';

/**
 * Persistence interface for per-game user settings overrides.
 * Mirrors the shape of SaveRepository (§4.11) — swappable for InMemorySettingsRepository in tests.
 */
export interface SettingsRepository {
    /** Load user overrides from storage. Returns empty object if no file exists yet. */
    load(gameId: string): Promise<UserSettings>;

    /** Persist updated user overrides atomically (write-tmp-then-rename). */
    save(gameId: string, overrides: UserSettings): Promise<void>;

    /** Delete the user overrides file. Next load() returns engine+game defaults. */
    reset(gameId: string): Promise<void>;
}
