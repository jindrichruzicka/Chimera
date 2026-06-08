---
title: 'Player Profiles & Directory'
description: 'EngineProfile interface, AvatarSource, GameProfileSchema<T>, ProfileRepository, ProfileManager, PlayerDirectory, ProfileSanitizer.admit() with 7 rejection types, attestation flow, mid-lobby update protocol, rate-limiting, and pass-and-play multi-seat support.'
tags: [profiles, identity, lobby, attestation, sanitization, directory]
---

# Player Profiles & Directory

> §4.24 of the Chimera architecture.
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) · [WebSocket Message Protocol](websocket-message-protocol.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Design Patterns

| Pattern         | Role                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Repository**  | `ProfileRepository` persists the local player's profile. Matches `SaveRepository` / `SettingsRepository` pattern. |
| **Directory**   | `PlayerDirectory` lives on the host; aggregates every connected client's sanitised profile.                       |
| **Attestation** | At join time the client attests its profile; the host sanitises and admits it into the directory.                 |

> **Key rule:** profile data is **strictly cosmetic**. It never enters `GameSnapshot`, `PlayerSnapshot`, `SaveFile`, or the action pipeline. Game mechanics that depend on player identity must be match-config values set at lobby setup.

---

## Core Types

```typescript
// simulation/profile/ProfileSchema.ts

interface EngineProfile {
    readonly localProfileId: string; // Stable client-local identifier; supports pass-and-play
    displayName: string; // Length-capped by ProfileSanitizer
    avatar: AvatarSource;
    locale: string; // BCP 47 tag
}

type AvatarSource =
    | { kind: 'builtin'; ref: AssetRef<TextureAsset> } // Zero transport cost
    | { kind: 'custom'; mimeType: 'image/png' | 'image/jpeg'; base64: string }; // Max 64 KB

type GameProfileSchema<T extends EngineProfile> = T;
type PlayerProfile = GameProfileSchema<EngineProfile>;
```

---

## ProfileRepository

```typescript
interface ProfileRepository {
    load(localProfileId: string): Promise<PlayerProfile | null>;
    save(profile: PlayerProfile): Promise<void>; // atomic .tmp rename
    listLocalSlots(): Promise<ReadonlyArray<{ localProfileId: string; displayName: string }>>;
    delete(localProfileId: string): Promise<void>;
}
```

---

## ProfileManager & PlayerDirectory

```typescript
// electron/main/profile/ProfileManager.ts
class ProfileManager {
    async getLocal(localProfileId: LocalProfileId): Promise<PlayerProfile>;
    /** Builds a candidate without persisting; throws PendingUpdateAlreadyActiveError if one is already active. */
    updateLocal(patch: Partial<Omit<PlayerProfile, 'localProfileId'>>): PlayerProfile;
    /** Returns the pending candidate if one exists, otherwise the last committed profile. */
    currentAttestation(): PlayerProfile;
    /** Persists the pending candidate to the repository (call on host ACK). */
    async acknowledgeUpdate(): Promise<PlayerProfile>;
    /** Discards the pending candidate without writing to disk (call on host REJECT). */
    discardCandidate(): void;
}

// electron/main/profile/PlayerDirectory.ts — HOST ONLY
class PlayerDirectory {
    add(playerId: PlayerId, profile: PlayerProfile): void;
    update(playerId: PlayerId, profile: PlayerProfile): void;
    remove(playerId: PlayerId): void;
    snapshot(): Readonly<Record<PlayerId, PlayerProfile>>;
    /** Clears all entries — call on lobby close. */
    reset(): void;
}
```

---

## ProfileSanitizer (Host-Side Trust Gate)

```typescript
// simulation/profile/ProfileSanitizer.ts

export const MAX_DISPLAY_NAME_LENGTH = 32;
export const MAX_CUSTOM_AVATAR_BYTES = 64 * 1024; // 64 KB decoded
export const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

type AdmissionResult =
    | { ok: true; profile: PlayerProfile }
    | { ok: false; reason: AdmissionRejection };

type AdmissionRejection =
    | 'DISPLAY_NAME_TOO_LONG'
    | 'DISPLAY_NAME_EMPTY'
    | 'AVATAR_TOO_LARGE'
    | 'AVATAR_INVALID_MIME'
    | 'AVATAR_DECODE_FAILED'
    | 'SCHEMA_MISMATCH'
    | 'NAMESPACE_COLLISION';

// Pure. Idempotent. Never throws.
//
// existingIds          — set of localProfileIds already in the current lobby;
//                        used for NAMESPACE_COLLISION detection. Defaults to empty set.
// gameSchemaValidator  — optional game-specific validator; receives the base-validated
//                        PlayerProfile and returns false to trigger SCHEMA_MISMATCH.
//                        Enables game extensions (e.g. a game-specific Profile) to enforce
//                        fields beyond the EngineProfile base.
function admit(
    attestation: unknown,
    existingIds?: ReadonlySet<string>,
    gameSchemaValidator?: (profile: PlayerProfile) => boolean,
): AdmissionResult;
```

### Rejection Catalogue

| Reason                  | Trigger                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `DISPLAY_NAME_EMPTY`    | `displayName.trim().length === 0`                                           |
| `DISPLAY_NAME_TOO_LONG` | `displayName.length > 32`                                                   |
| `AVATAR_INVALID_MIME`   | Custom avatar `mimeType` not in `ALLOWED_AVATAR_MIME_TYPES`                 |
| `AVATAR_TOO_LARGE`      | Decoded bytes > 64 KB                                                       |
| `AVATAR_DECODE_FAILED`  | base64 decode throws, or bytes fail magic-bytes PNG/JPEG check              |
| `SCHEMA_MISMATCH`       | Missing required field, wrong type, or game-schema validator returned false |
| `NAMESPACE_COLLISION`   | `localProfileId` matches reserved prefix or duplicates existing lobby entry |

---

## Attestation Flow

```
Host creates lobby
  ProfileManager.currentAttestation() → profile A
  PlayerDirectory.add(host, profile A)

Client B sends JOIN { token, profile B }
  ProfileSanitizer.admit(profile B) → { ok, profile B' }
  PlayerDirectory.add(clientB, profile B')
  → WELCOME { playerId, lobbyState: { profiles: { host: A, clientB: B' } } }
  → broadcast LobbyState to all

All renderers: profileStore.directory = { host: A, clientB: B' }
```

---

## Mid-Lobby Profile Update (Attest-First, Persist-on-ACK)

1. Renderer calls `window.__chimera.profile.updateLocal(patch)`.
2. `ProfileManager` builds a **candidate** (does NOT yet save to disk). Sends `PROFILE_UPDATE { profile }` via `ClientTransport.sendSideChannel()`.
3. Host: `ProfileSanitizer.admit()` validates.
    - **On success**: `PlayerDirectory.update()` → rebroadcast `LobbyState` → ACK to client.
    - **On failure**: `REJECT { reason: 'profile:<AdmissionRejection>' }` returned.
4. Client receives ACK → `ProfileRepository.save()` persists to disk → `profileStore` updated.
   Client receives REJECT → candidate discarded; disk + directory unchanged; toast surfaces reason.

**Rate limit**: 1 `PROFILE_UPDATE` per 5 seconds per client. Excess rate generates non-fatal UI warning.

---

## Pass-and-Play Multi-Seat

Pass-and-play multi-seat handoff is driven by the host's projected `PlayerSnapshot.isMyTurn` value. When a local seat ends its turn, `engine:end_turn` advances the authoritative turn clock, the host reprojects the next local seat's `PlayerSnapshot`, and the renderer enables controls from that snapshot without a manual viewer-switch IPC call.

`ProfileRepository.listLocalSlots()` still lists profiles persisted on the local machine for profile management. Each local seat attests its own profile to the host identically to a remote client, but profile-slot selection is separate from turn handoff.

---

## Invariants

| #   | Rule                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #59 | Profile data (avatar, display name, locale, game-defined fields) is never stored in `GameSnapshot`, `PlayerSnapshot`, or `SaveFile`.                                                                          |
| #60 | `ProfileRepository` persists only the local machine's profiles. Remote clients' profiles live only in the in-memory `PlayerDirectory` for the lobby lifetime.                                                 |
| #61 | `ProfileSanitizer.admit()` is the mandatory gate between inbound `JOIN`/`PROFILE_UPDATE` and `PlayerDirectory`. A failed admission results in a `REJECT` — raw attestation never reaches any other subsystem. |
| #62 | Profile updates over side-channel are rate-limited. The host enforces the limit; clients surface excess rejections as non-fatal UI warnings only.                                                             |

---

## Cross-References

- [Multiplayer Provider](multiplayer-provider-websocket.md) — `SideChannelMessage { kind: 'profile' }`
- [WebSocket Message Protocol](websocket-message-protocol.md) — `JOIN` profile attestation, `PROFILE_UPDATE`
- [Electron Shell](electron-shell-ipc-bridge.md) — `ProfileAPI` IPC namespace
