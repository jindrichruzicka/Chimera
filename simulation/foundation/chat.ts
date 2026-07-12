/**
 * shared/chat.ts
 *
 * Canonical chat contract shared across the host relay, the wire protocol, and
 * the renderer. This is the type surface the Chat System (§4.29) builds on:
 * the routing scope, the relayed message shape, and the relay outcome.
 *
 * **Scope:** Types only — no relay logic, no validation, no UI. The host-side
 * `ChatRelay` assigns `id` + `serverTime`, applies the length cap, rate
 * limit, and scope validation (Invariant #73), then rebroadcasts per `scope`.
 *
 * Chat is a cosmetic communication channel. A `ChatMessage` is NEVER an
 * `EngineAction`: it must not advance `tick`, enter `ActionPipeline` /
 * `ActionHistory`, or appear in replays / saves (Invariant #72). It travels as
 * a `SideChannelMessage`, parallel to `PROFILE_UPDATE`.
 *
 * Architecture: §4.29 — Chat System
 *
 * Invariants upheld:
 *   #2  — Zero runtime imports from electron/, renderer/, or DOM APIs;
 *         `PlayerId` is referenced via `import type` only.
 *   #72 — `ChatMessage` is a cosmetic side-channel payload, not an EngineAction.
 */

import type { PlayerId } from './engine-contract.js';

/**
 * Routing scope of a chat message. The discriminant `kind` selects the
 * recipient set the host relay rebroadcasts to:
 *
 * - `lobby`   — every connected player.
 * - `team`    — players whose team matches `teamId`.
 * - `private` — the sender plus the single `toPlayerId` recipient.
 */
export type ChatScope =
    | { readonly kind: 'lobby' }
    | { readonly kind: 'team'; readonly teamId: string }
    | { readonly kind: 'private'; readonly toPlayerId: PlayerId };

/**
 * A relayed chat message as seen by recipients. `id` and `serverTime` are
 * assigned by the host relay; clients never author them.
 */
export interface ChatMessage {
    /** Stable identifier assigned by the host relay. */
    readonly id: string;
    /** Player who authored the message. */
    readonly fromPlayerId: PlayerId;
    /** Routing scope chosen by the sender. */
    readonly scope: ChatScope;
    /** Message text (length-capped by the relay before rebroadcast). */
    readonly body: string;
    /** Host-stamped time of relay. */
    readonly serverTime: number;
}

/**
 * Why a submitted chat message did not result in a relay. The first four are
 * the host relay's policy rejections — `invalid_scope` covers an unknown
 * discriminant or a recipient the sender may not address. `no_session` is a
 * *submission-path* outcome, not a relay-policy one: the local sender had no
 * active hosted session to gate the message (e.g. `send` was called before a
 * lobby was hosted, or from a joined client whose wire send-path is not yet
 * implemented). The host relay (`ChatRelay.relay`) never emits `no_session`, so
 * the host→sender `chat_reject` frame never carries it; it surfaces only on the
 * local `RelayResult` returned by the submission path.
 *
 * This is the single source of truth for both {@link RelayResult} and the
 * `chat_reject` side-channel frame the host sends back to the offending sender.
 */
export type ChatRejectReason =
    | 'too_long'
    | 'rate_limited'
    | 'empty'
    | 'invalid_scope'
    | 'no_session';

/**
 * Outcome of submitting a chat message to the host relay.
 */
export type RelayResult =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: ChatRejectReason };
