/**
 * electron/main/content/gameContentRegistry.ts
 *
 * Main-side registry mapping `gameId → content registration` (the per-collection
 * Zod schemas a game supplies for its own data). This is the designated
 * *composition point* for game content contracts: the only place permitted to
 * import a `games/*` content module, so the generic `ContentLoader` and the
 * engine stay agnostic about which games author which collection shapes
 * (Invariant #2). Tactics is the first adopter; further games register here the
 * same way.
 *
 * The data directory itself is NOT named here — it is derived generically from
 * the runtime `gameAssetsRoot` as `<root>/<gameId>/data` in `loadGameContent.ts`.
 *
 * Architecture: §4.8 — Content Database
 */

import type { ZodType } from 'zod';
import { TACTICS_CONTENT_SCHEMAS } from '@chimera/tactics/content/tacticsContent.js';

/** What a game declares about its content for the loader. */
export interface GameContentRegistration {
    /** Per-collection Zod schemas, keyed by collection type (data subdirectory). */
    readonly schemas: Readonly<Record<string, ZodType>>;
}

/**
 * `gameId → registration`. Concrete games are registered here by importing their
 * content module from `games/*` (the sole module allowed to do so). A game with
 * no content simply does not appear — its `ContentDatabase` stays absent and
 * `PipelineContext.db` is `undefined` for it (Invariant #46).
 */
export const gameContentRegistry: Readonly<Record<string, GameContentRegistration>> = {
    tactics: { schemas: TACTICS_CONTENT_SCHEMAS },
};
