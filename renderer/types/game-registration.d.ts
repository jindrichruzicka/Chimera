// renderer/types/game-registration.d.ts
//
// Ambient declaration for the synthetic game-registration specifier (#784).
//
// `renderer/**` source must name no game, so the renderer pulls in the active
// game's renderer contribution through this build-selected specifier rather than
// importing a `@chimera-engine/<game>` / `apps/*` path. `renderer/next.config.ts`
// aliases it to the consumer app's renderer composition root
// (`apps/tactics/renderer/register.ts`), whose import side effect registers the
// game. There is no real module behind the specifier at type-check time — it is
// a side-effect-only import — so this shim lets `tsc` resolve it without a body.
declare module 'chimera-game-registration';
