/**
 * shared/game-content-contract.ts
 *
 * Generic, game-agnostic shape for content-database collections as they cross a
 * process boundary (main → renderer over IPC) and flow into a game's renderer
 * surfaces as a prop.
 *
 * The engine, IPC framework, and renderer never interpret these collections:
 * each item is only guaranteed to carry a string `id` plus arbitrary JSON
 * fields. A concrete game (e.g. `games/tactics/`) owns the Zod schema that
 * validates its collections at load time and the code that reads the fields it
 * authored. This keeps the engine agnostic about which games use which data
 * contracts (Invariant #2; §4.8 Content Database).
 *
 * Mirrors the in-memory `ContentDatabase` shape (`collectionType → items`) but
 * carries only plain data — no query methods — because the renderer may only
 * type-import `simulation/content` and so cannot reconstruct a live
 * `ContentDatabase`.
 *
 * Module boundary (§3): `shared/` carries zero runtime imports; this module is
 * pure types.
 */

/**
 * A single content item: a string `id` plus whatever extra JSON fields the
 * authoring game declared. Consumers narrow the unknown fields themselves.
 */
export type GameContentItem = Readonly<{ id: string } & Record<string, unknown>>;

/**
 * All of a game's content, keyed by collection type (the data subdirectory
 * name, e.g. `'player-colors'`). The value is the collection's items in
 * deterministic (id-sorted) order, as produced by `ContentDatabase.getAll`.
 */
export type GameContent = Readonly<Record<string, readonly GameContentItem[]>>;
