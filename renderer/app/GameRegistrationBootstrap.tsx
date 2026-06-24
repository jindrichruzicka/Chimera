'use client';

// renderer/app/GameRegistrationBootstrap.tsx
//
// Runs the active game's renderer registration in the CLIENT bundle (#784).
//
// `renderer/**` names no game; the game's renderer contribution enters through
// the synthetic `chimera-game-registration` specifier, which `next.config.ts`
// aliases onto the consumer app's renderer composition root
// (`apps/tactics/renderer/register.ts`). That module's import side effect calls
// `registerRendererGame(...)`. The import lives at module scope here, and the
// component is a `'use client'` module mounted at the root of `AppShell`, so the
// registration is evaluated as the client bundle loads — before any page effect
// reads the registry via `loadRendererGame`/`getDefaultRendererGameId`.
//
// It MUST live in a `'use client'` module: `layout.tsx`/`AppShell.tsx` are Server
// Components whose module side effects are stripped from the client bundle, where
// the registry is actually read.
import 'chimera-game-registration';

export function GameRegistrationBootstrap(): null {
    return null;
}
