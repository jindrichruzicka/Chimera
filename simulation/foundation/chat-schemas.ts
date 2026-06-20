/**
 * shared/chat-schemas.ts
 *
 * Runtime Zod schema for the chat routing scope, mirroring {@link ChatScope} in
 * `shared/chat.ts`. This is the single definition reused by every *server-side*
 * boundary that must validate a scope:
 *
 *   - the wire protocol's `CHAT` frame (`shared/messages-schemas.ts`),
 *   - the main-process IPC request for `chimera:chat:send` (`electron/main/ipc/ipc-schemas.ts`).
 *
 * The preload boundary owns an independent copy (Invariant #5: no schema file
 * spans the main↔preload IPC boundary), so this module is never imported by
 * `electron/preload/`. Likewise, the relayed `ChatMessage` / `RelayResult` shapes
 * are validated only where they cross a trust boundary (the preload response
 * gate); the host *produces* them and so needs no schema for them here.
 *
 * **Scope:** the scope schema only — no relay logic, no IPC, no UI.
 *
 * Architecture: §4.29 — Chat System
 * Task: F45 / T03 (issue #681)
 *
 * Invariants upheld:
 *   #2 — Zero runtime imports from electron/, renderer/, simulation/, or DOM
 *        APIs. `PlayerId` is a branded string in the engine; here it is validated
 *        structurally as a plain string (the brand is a compile-time concern,
 *        re-applied by branded schemas in the consuming layers).
 */

import { z } from 'zod';

/**
 * `PlayerId` is a branded string in the engine. At the wire/IPC boundary it
 * arrives as a plain string; the brand is re-applied by branded schemas in the
 * consuming layers (e.g. `PlayerIdSchema` in `ipc-schemas.ts`). Here we validate
 * structure only.
 */
const PlayerIdLike = z.string();

/**
 * Routing scope of a chat message. Mirrors {@link import('./chat.js').ChatScope}.
 * `.strict()` rejects unknown keys so a stale client that adds fields is detected
 * at the boundary; the discriminated union rejects an unknown `kind` before any
 * field is read.
 */
export const ChatScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lobby') }).strict(),
    z.object({ kind: z.literal('team'), teamId: z.string() }).strict(),
    z.object({ kind: z.literal('private'), toPlayerId: PlayerIdLike }).strict(),
]);
