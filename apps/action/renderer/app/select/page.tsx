// The action app's `/select` route — a GAME-OWNED shell page (§4.37.17).
//
// Unlike every sibling route in this tree, this is NOT a re-export of an engine
// shell page: the engine ships no character picker, and it could not — what is
// being picked is this game's own. It is a physical Next page here, declared on
// the shell payload's `shellRoutes` in `renderer/loaders.ts`; that declaration
// is what makes the engine treat it as part of the shell rather than as a route
// it knows nothing about.
//
// A re-export rather than a body, so the screen itself sits with the rest of
// this game's shell (`shell/ActionSelectScreen.tsx`) where its unit tests and
// its stylesheet already live, and the route file stays what it is: a
// declaration that this path exists.
//
// It reaches the screen by the app's own package specifier rather than by a
// relative path: the app root is three directories up from here, and a
// `../../../*` reach is banned repo-wide (`eslint.config.mjs`). The specifier
// resolves through the workspace symlink that pnpm links at
// `node_modules/@chimera-engine/action`, with `next.config.ts`'s `extensionAlias`
// mapping the `.js` suffix onto the `.tsx` source — the same path
// `apps/tactics/renderer/app/model-showcase/page.tsx` already takes.
//
// The `'use client'` directive is the screen's own — a re-export carries the
// re-exported module's directive, not this file's.
export { ActionSelectScreen as default } from '@chimera-engine/action/shell/ActionSelectScreen.js';
