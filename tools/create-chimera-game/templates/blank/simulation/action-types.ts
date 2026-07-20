// __Game Title__'s action payload interfaces. Lives here — separate from
// actions.ts (reducers) and action-schemas.ts (Zod validators) — so neither
// module needs to import from the other to share types.
//
// Module boundary: no simulation/engine imports — never renderer or electron.

/** Example action payload — replace with your game's real payloads. */
export interface __GamePascal__PingPayload {
    readonly note: string;
}
