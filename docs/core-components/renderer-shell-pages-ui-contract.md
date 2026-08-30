---
title: 'Renderer Shell Pages UI Contract'
description: 'Token-based styling contract for engine shell pages (main-menu, lobby, settings, saves). Defines which pages are shell-owned vs. game-owned, how the shared Button component is consumed, how GameMainMenuDefinition customizes the main menu, how GameSettingsPageDefinition customizes the settings page, how a game contributes a customizable LobbyScreen (host-authored game params), when game token overrides apply, and the invariants that prohibit inline styles on shell pages.'
tags:
    [
        renderer,
        ui,
        design-tokens,
        shell-pages,
        button,
        theming,
        lobby,
        main-menu,
        settings,
        game-shell-contract,
    ]
---

# Renderer Shell Pages UI Contract

> §4.37 of the Chimera architecture.
> Related: [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) · [Settings System](settings-system.md) · [Renderer State Stores](renderer-state-stores.md) · [Multiplayer Provider & WebSocket](multiplayer-provider-websocket.md)

---

## Overview

§4.35 defines the engine design-token system and `renderer/components/ui/` component library for
content that renders _inside_ `GameShell`. This section documents the same contract for
**engine shell pages** — top-level Next.js pages that exist outside of any game match:

Game renderer surfaces may also consume the public component-library barrels under the narrower
§4.35 game-surface rule. Shell pages remain renderer-owned surfaces: they import UI primitives directly,
load game customization only through renderer registry helpers, and never import game screen modules
or token overrides directly.

| Page path                         | Purpose                                                  | Game-owned?                     |
| --------------------------------- | -------------------------------------------------------- | ------------------------------- |
| `renderer/app/main-menu/`         | Title screen, entry point                                | Engine-owned; game-customizable |
| `renderer/app/lobby/`             | Route-backed modal for host/join/leave multiplayer lobby | Partly\*                        |
| `renderer/app/settings/`          | Engine + game settings UI                                | Engine-owned; game-customizable |
| `renderer/app/saves/`             | Save-slot browser                                        | No                              |
| `renderer/app/(loading)/`         | Transition placeholder between scenes                    | No                              |
| `renderer/app/component-gallery/` | Design-system gallery; gated by `isGalleryEnabled()`     | No                              |

\* The lobby page loads game-specific configuration from `LobbyConfig` for host/join requests, but
its chrome (dialog, tabs, buttons, layout, player list) is engine-owned. Game token overrides are
applied to the lobby page only when an explicit shell game context is present in the launch or route
URL (see §4.37.4); the lobby's runtime/default config does not invent shell theming context.

---

## 4.37.1 Token Requirement for Shell Pages

Shell pages consume the same `--ch-*` custom property set defined in `renderer/styles/tokens.css`
(§4.35). The root layout (`renderer/app/layout.tsx`) imports this stylesheet globally, so tokens
are always in scope.

**Rule:** No shell page component may use a hardcoded colour, spacing, or radius value — not even
as an inline `style` prop. Every visual attribute must reference a `var(--ch-*)` token or a scoped
CSS Module class whose declarations use `var(--ch-*)`.

```tsx
// ✅ Correct — token-referenced inline style (transitional; prefer CSS Module)
<button style={{ background: 'var(--ch-color-surface-raised)', color: 'var(--ch-color-text-primary)' }}>
    Play
</button>

// ✅ Correct — component from renderer/components/ui/
<Button variant="primary" onClick={...}>Play</Button>

// ❌ Wrong — hardcoded hex value
<button style={{ background: '#222', color: '#eee' }}>Play</button>

// ❌ Wrong — inline styles that bypass the token system entirely
const styles = { button: { background: '#222', border: '1px solid #555' } };
```

---

## 4.37.2 Shared `Button` Component on Shell Pages

Shell pages must use `renderer/components/ui/Button.tsx` (§4.35) for all interactive actions. The
full component API is reproduced here for reference:

```typescript
// renderer/components/ui/Button.tsx

export interface ButtonProps {
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; // default: 'primary'
    readonly size?: 'sm' | 'md' | 'lg'; // default: 'md'
    readonly disabled?: boolean;
    readonly onClick?: () => void;
    readonly className?: string;
    readonly style?: React.CSSProperties; // token overrides only — no hardcoded values
    readonly children: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
```

### Variant Assignment Guide for Shell Pages

| Action                          | Variant     | Example usage             |
| ------------------------------- | ----------- | ------------------------- |
| Primary navigation / game start | `primary`   | Play, Start Game, Confirm |
| Secondary navigation / neutral  | `secondary` | Settings, Back            |
| Inline / low-prominence action  | `ghost`     | Cancel, Skip              |
| Destructive / irreversible      | `danger`    | Quit, Leave Lobby, Delete |

No custom `variant` values are permitted on shell pages. Games extend the visual language via
token overrides (§4.37.4), not by inventing new variant names.

---

## 4.37.3 Layout Tokens for Shell Pages

Shell page containers should also use tokens rather than hardcoded layout values:

```tsx
// renderer/app/main-menu/page.tsx — after migration
<main
    data-testid="main-menu"
    style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 'var(--ch-space-sm)',
    }}
>
    <Button variant="primary" onClick={() => router.push('/lobby')}>
        Play
    </Button>
    <Button variant="secondary" onClick={() => router.push('/settings')}>
        Settings
    </Button>
    <Button variant="danger" onClick={quit}>
        Quit
    </Button>
</main>
```

---

## 4.37.4 Game Token Overrides on Shell Pages

When a game is in context, shell-level UI may load the game's renderer shell contribution through
the renderer game registry. This context is explicit launch or URL state such as
`/main-menu/?gameId=<game>`, `/settings/?gameId=<game>`, or `/lobby/?gameId=<game>`; it does not
require a running lobby to exist. The default production launch route carries the built-in game's
`gameId`, so normal shell navigation preserves a stable game context from first paint. Lobby runtime
state and `LobbyConfig` defaults are not used as shell background/theme context. Once a game registry
or renderer shell module is imported, shell-level UI automatically inherits the game's token override
CSS, because the override is a side-effect import loaded at game registry initialisation time
(§4.35):

```typescript
// apps/<game>/styles/register-token-overrides.tsx
import './tokens-override.css'; // Re-declares --ch-* tokens for the game's visual language

// apps/<game>/screens/index.tsx and renderer-owned shell loaders import the registration module.
export const gameScreenRegistry: GameScreenRegistry = { ... };
```

Because token overrides are global CSS custom properties, they cascade into _all_ descendant
elements — including shell pages mounted in the same document — once the game registry or renderer
shell module has been imported. Shell pages therefore receive game theming without any explicit
wiring.

The same cascade carries the overlay **motion** tokens (`--ch-*-anim-*`, §4.35 Motion & Animation,
invariant #109): a game may retime, disable, or reshape the shell's Modal/Drawer open-close
animations from its `tokens-override.css` alone. The engine's keyframes load globally from
`renderer/styles/animations.css` (imported by the root layout after `tokens.css`); because the game
override loads later in the cascade, an override that sets literal durations must ship its own
`@media (prefers-reduced-motion: reduce)` block.

### Scope Rules

| Page              | Receives game override?                                     |
| ----------------- | ----------------------------------------------------------- |
| `main-menu`       | Yes — when explicit URL game context is present             |
| `settings`        | Yes — when explicit URL or active lobby game context exists |
| `saves`           | Never (engine-owned, game-agnostic)                         |
| `lobby`           | Yes — when explicit launch or URL game context is present   |
| Match / GameShell | Yes — always (registry imported before scene render)        |

### Lobby Modal Surface

`renderer/app/lobby/page.tsx` is a normal shell route, but it presents its content through the
shared chrome-less `Modal` (§4.35, `size="xl"`) over the shared shell background. The route
remains `/lobby` so refresh, deep-link, E2E, and IPC bootstrap behavior stay unchanged. Closing
the dialog navigates back to `/main-menu`, preserving an explicit `?gameId=` URL context when
present. The dialog carries `aria-modal` with the Modal's real focus trap (superseding the old
no-trap rationale for omitting it).

When no session exists, the lobby dialog renders a two-tab entry surface and a footer action row:

| Tab    | Purpose                                           |
| ------ | ------------------------------------------------- |
| `Host` | Confirms hosting with the parsed `LobbyConfig`    |
| `Join` | Accepts a lobby code/address and confirms joining |

The footer is the Modal's right-aligned action row, ordered `Close`, then the active tab's
primary action (`Host Lobby` or `Join Lobby`). Host/Join are `dismiss: false` actions — a
failure keeps the form open with its error banner. Escape in entry mode closes like the `Close`
button. The heading area stays quiet: it does not render lobby config badges, connection badges,
or helper captions beneath the title.

When `lobbyStore.lobbyState` is non-null, the entry tabs disappear and the footer becomes the
Modal's `Leave Lobby` (danger, `aria-describedby` pointing at a visually-hidden consequence
warning in the body) and host-gated `Start Game` (primary) actions — both `dismiss: false`, sized
and aligned exactly like every other modal's buttons. Lobby screens (the engine default and
game-provided ones alike) render only body content — session metadata, roster, ready-state and
setup controls — never their own Leave/Start bar. Escape is consumed as a no-op during an active
session — leaving stays the explicit `Leave` action. All authoritative writes continue through
`useLobbyApi()`; the route component never writes the IPC-mirrored `lobbyStore` directly.

The settings (`/settings`, `size="lg"` + `fixedHeight` so tab switches never resize the dialog),
saves (`/saves`, `size="lg"`), and replays (`/replays`, `size="lg"`) routes present through the
same chrome-less `Modal`: title, scrolling body, and a right-aligned footer (`Reset` +
`Close` for settings — `Reset` is `dismiss: false`; a lone `Close` for the browsers). Their
delete-confirm dialogs stay nested `Modal`s — the `EscapeStack` routes Escape to the confirm
first, then the page. Escape during settings key-binding capture cancels only the capture (the
capture registers its own escape layer above the page modal).

A game may customize the in-session surface by contributing a `LobbyScreen` component
(`GameScreenRegistry.LobbyScreen`, loaded via the renderer game registry). When present, the engine
renders it with `GameLobbyScreenProps` in place of the default roster UI; the host authors host-only
**game params** (`LobbyState.gameParams`) via `setGameParam`, while each player authors only its
OWN seat's **player attributes** (`LobbyPlayerEntry.attributes`, e.g. unit colour) via
`setPlayerAttribute`. Clients see another seat's values read-only. The full data and authority contract —
including how the agreed configuration becomes `snapshot.setup` — lives in §4.37.12 below and the
[Customizable Lobby Contract](customizable-lobby-contract.md).

Game context reaches the renderer **only** as an external `?gameId=` — the launcher stamps it
(`buildRendererGameLaunchUrl`) and `withShellGameId` carries it across in-app navigation. The engine
never names, stores, or derives a game of its own, so no route may fall back to "the registered
game": a URL without `?gameId=` genuinely has no game context. Every shell route resolves it through
the one reader, `resolveShellGameId`, and renders its engine defaults when the answer is `null`.

For the lobby that means a single id — the URL's — drives both the host request and the shell
branding, so a `LobbyScreen` can never disagree with the game being hosted. A game-provided
`LobbyScreen` renders when the active session's `gameId` matches it; an explicit `?gameId=` naming a
different game than the session hosts falls back to the engine-default panel. With no `gameId` at
all there is nothing to host, so the `Host` action is disabled — joining stays available because the
host's response carries the game. This is distinct from the engine defaults a game opts into by
contributing no shell (a fresh `create-chimera-game` scaffold): there the game context is present and
the engine simply supplies the default menu, settings, lobby, and background.

---

## 4.37.5 Game-Customizable Main Menu Definition

Games customize the top-level main menu by contributing a declarative
`GameMainMenuDefinition` through their renderer shell registration. The shared contract lives in
`simulation/foundation/game-shell-contract.ts`, so `renderer/` and `apps/*` can both depend on the
type without creating a renderer-to-game static import.

```typescript
export type GameMenuCommandId = string & { readonly __brand: 'GameMenuCommandId' };

export interface GameMainMenuLayout {
    readonly orientation?: 'vertical' | 'horizontal';
    readonly align?: 'center' | 'start' | 'end';
    readonly anchor?:
        | 'center'
        | 'top'
        | 'bottom'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly gap?: number;
}

export type GameMainMenuAction =
    | { readonly type: 'navigate'; readonly target: string }
    | { readonly type: 'quit' }
    | { readonly type: 'open-lobby' }
    | { readonly type: 'start-game'; readonly config?: QuickStartConfig }
    | { readonly type: 'continue' }
    | { readonly type: 'command'; readonly commandId: GameMenuCommandId };

export type GameMenuConfirmTrigger = 'always' | 'autosave-exists';

export interface GameMenuConfirm {
    readonly when: GameMenuConfirmTrigger;
    readonly title: string;
    readonly body?: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
}

export interface GameMainMenuButton {
    readonly id?: string;
    readonly label: string;
    readonly action: GameMainMenuAction;
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    readonly disabled?: boolean | (() => Promise<boolean>);
    readonly confirm?: GameMenuConfirm;
}

export interface GameMainMenuDefinition {
    readonly layout?: GameMainMenuLayout;
    readonly buttons: readonly GameMainMenuButton[];
}
```

### Layout Defaults

| Field         | Type                                                                                            | Default         | Renderer behavior                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orientation` | `'vertical' \| 'horizontal'`                                                                    | `'vertical'`    | Maps to `flex-direction: column` or `row`.                                                                                                                 |
| `align`       | `'center' \| 'start' \| 'end'`                                                                  | `'center'`      | Maps to `align-items: center`, `flex-start`, or `flex-end`.                                                                                                |
| `anchor`      | `'center' \| 'top' \| 'bottom' \| 'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'center'`      | `center` stays in normal flow; edge anchors position the wrapper absolutely using tokenized zero edges.                                                    |
| `offsetX`     | `number`                                                                                        | `0`             | Horizontal pixel offset applied through CSS custom properties (`--menu-offset-x`) rather than bare inline pixel transforms.                                |
| `offsetY`     | `number`                                                                                        | `0`             | Vertical pixel offset applied through CSS custom properties (`--menu-offset-y`) rather than bare inline pixel transforms.                                  |
| `gap`         | `number`                                                                                        | `--ch-space-sm` | Must resolve to a design token. The renderer accepts `0`, `4`, `8`, `16`, `24`, and `40`, mapping to `--ch-space-none/xs/sm/md/lg/xl`; other values throw. |

`layout` itself is optional. When a game provides a partial layout, omitted fields use the
defaults above. `buttons` is required and may be an empty array; an empty array renders an empty
menu.

### Button and Action Semantics

| Field / variant     | Required? | Meaning                                                                                                                                                                                                                                                                                           |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`             | Yes       | Visible button text rendered as the children of the shared `<Button>`.                                                                                                                                                                                                                            |
| `action.type`       | Yes       | Discriminant for the action union.                                                                                                                                                                                                                                                                |
| `navigate.target`   | Yes       | Internal renderer route passed to `router.push(target)`, for example `'/settings'`, `'/saves'`, or `'/game'`.                                                                                                                                                                                     |
| `quit`              | Yes       | Calls `window.__chimera.system.quit()` through the renderer system bridge.                                                                                                                                                                                                                        |
| `open-lobby`        | Yes       | Engine shortcut for `router.push('/lobby')`; this is the engine default Play action.                                                                                                                                                                                                              |
| `start-game`        | Yes       | Invokes `chimera:lobby:quick-start` for the active game, with the optional `config` merged over the game's own `GameLobbySetup.quickStart` defaults. Does **not** navigate — see _Routing_ below.                                                                                                 |
| `continue`          | Yes       | Loads `autosaveSlotId(gameId)` through the ordinary restore funnel (`saves.load`), so no restore machinery is added. The engine picks the slot; a game names none. Does **not** navigate.                                                                                                         |
| `command.commandId` | Yes       | Branded `GameMenuCommandId` resolved against the game's registered `menuCommands` registry.                                                                                                                                                                                                       |
| `id`                | No        | Testid slug: the renderer tags the button `main-menu-<id>`. Supply one for an entry the built-in derivation cannot name (a `command`, or a navigation to a game-owned route).                                                                                                                     |
| `variant`           | No        | Passed to the shared `<Button>` as `primary`, `secondary`, `ghost`, or `danger`.                                                                                                                                                                                                                  |
| `disabled`          | No        | Controls the `<Button>` disabled state. `boolean` is a static state evaluated at render time; `() => Promise<boolean>` is an async availability check the renderer awaits (e.g. "are there any replays to browse?"). See _Engine-Computed Availability_ below for the gates resolved ahead of it. |
| `confirm`           | No        | Asks the player before the action runs, through the single engine confirm surface (§4.35). Omitted means the action runs immediately.                                                                                                                                                             |

When `variant` is omitted, `RenderMainMenuDefinition` assigns a renderer default: `danger` for
`quit`, `primary` for the first non-quit button, and `secondary` for all remaining buttons.

`disabled` accepts either a plain `boolean` or an async check `() => Promise<boolean>`. For the
async form, `RenderMainMenuDefinition` evaluates the check once per button (in a `useEffect` keyed
on the `buttons` array) and stores the result per index. The button renders **disabled while the
check is pending** — a fail-safe that avoids a flash of enabled→disabled — and a thrown or rejected
check is likewise treated as `true` (disabled) and logged at `warn`.

### Engine-Computed Availability

These conditions are the renderer's to answer, not the game's, so they are evaluated **before** a
declared `disabled` and win over it — a declaration cannot offer a Continue with nothing to
continue:

- Both engine verbs are disabled while a lobby session is live (host or joined alike): the menu is
  not the surface for acting on a session already in progress.
- A `continue` button is additionally disabled while the active game has no autosave.
- A button whose `confirm.when` is `'autosave-exists'` is disabled while the save slot list is still
  loading **and** a game is in context: until that list arrives, "is there a save to overwrite?" has
  no answer, and a first-run player must never be told they are about to overwrite a save that does
  not exist. With no game in context there is nothing to list, so that case never waits.

These are **reactive** — an honest change from the resolve-once model the async `disabled` check
follows. `RenderMainMenuDefinition` subscribes to `saveStore` and `lobbyStore`, so a
`chimera:saves:slot-update` push flips a Continue button live: enabled the moment an autosave
lands, disabled again the moment one is deleted, with no game-side probe.

`start-game` and `continue` each address one concrete game. Rendering either with no `gameId` in
context is a malformed declaration and throws at render time, exactly as an unregistered
`command.commandId` does.

### Routing

Neither verb navigates: each issues its IPC call and returns. The hop into the match belongs to the
renderer's snapshot → `/game` effect (`renderer/app/GameStoreBootstrap.tsx`), whose entry allow-set
covers `/main-menu` — see §4.37.17.

### Confirmation

`confirm` resolves through the one `ConfirmDialogHost` that `AppShell` mounts (§4.35) — the same
surface `useConfirmDialog()` writes to. `when: 'always'` asks on every activation;
`when: 'autosave-exists'` asks only while the active game has an autosave the action would
overwrite, and runs the action straight through when it does not. Declining — the Cancel control or
Escape — leaves the menu untouched and the action unrun.

`title`, `body`, `confirmLabel` and `cancelLabel` resolve through `t()` at the render site on the
same terms as `label`: a translation token resolves, and text with no matching token passes through
unchanged. Omitted control labels fall back to the engine's `engine.common.confirm` /
`engine.common.cancel` tokens.

### Button Testids

`RenderMainMenuDefinition` takes the derivation as a `getButtonTestId` prop;
`renderer/app/main-menu/page.tsx` supplies it. A declared `id` wins and becomes `main-menu-<id>`.
Otherwise the built-in map applies, unchanged from before the two engine verbs landed, so an
existing game's page objects keep resolving:

| Entry                                     | Testid                |
| ----------------------------------------- | --------------------- |
| `open-lobby`, or `navigate` to `/game`    | `main-menu-play`      |
| `navigate` to `/settings`                 | `main-menu-settings`  |
| `navigate` to `/saves`                    | `main-menu-load-game` |
| `navigate` to `/replays`                  | `main-menu-replays`   |
| `start-game`                              | `main-menu-start`     |
| `continue`                                | `main-menu-continue`  |
| `quit`                                    | `main-menu-quit`      |
| `command`, or any other `navigate` target | untagged              |

## 4.37.6 Main Menu Fallback Chain

`renderer/app/main-menu/page.tsx` resolves the active game shell from explicit URL state only:
`resolveMainMenuGameId(new URLSearchParams(window.location.search))` reads `?gameId=<id>`. This
keeps the main menu independent of an active lobby or match.

The fallback chain is intentionally shallow:

1. If `?gameId=<id>` resolves and `loadRendererGameShell(id)` succeeds, use
   `LoadedRendererGameShell.mainMenu` and `LoadedRendererGameShell.menuCommands`.
2. If the loaded shell omits `mainMenu`, `RenderMainMenuDefinition` receives `undefined` and uses
   the engine default definition.
3. If there is no `gameId`, or the shell load fails, the page also passes `undefined`, which uses
   the engine default definition.

While the URL-selected shell is unresolved or loading, the page renders only the shell container.
This prevents the engine default Play / Settings / Quit buttons from flashing before a game menu
definition resolves.

When a URL-selected game menu is loaded, `navigate` and `open-lobby` actions preserve the active
`gameId` query parameter for root-relative shell routes. This lets game-customized shell pages round
trip between `/main-menu/?gameId=<id>` and `/settings/?gameId=<id>` without requiring each game to
hardcode query strings in its declarative menu definition.

The engine default is itself a `GameMainMenuDefinition`:

```typescript
const ENGINE_DEFAULT_DEFINITION: GameMainMenuDefinition = {
    layout: { orientation: 'vertical', align: 'center', anchor: 'center' },
    buttons: [
        { label: 'Play', action: { type: 'open-lobby' }, variant: 'primary' },
        {
            label: 'Settings',
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        { label: 'Quit', action: { type: 'quit' }, variant: 'danger' },
    ],
};
```

There is no partial merge between a game definition and the engine default. A provided definition
owns its button list; only omitted field-level defaults from `GameMainMenuLayout` and
`GameMainMenuButton.variant` are applied.

## 4.37.7 Game Font Contributions

Games may contribute self-hosted font faces through `LoadedRendererGameShell.fonts`. Font
declarations are pure shared data, so game packages declare them in `apps/<name>/shell/fonts.ts`
using the `GameFontFace` type from `simulation/foundation/game-shell-contract.ts`; the renderer registry imports
that data while assembling the game shell bundle.

```typescript
export interface GameFontFace {
    readonly family: string;
    readonly src: string;
    readonly weight?: string;
    readonly style?: 'normal' | 'italic';
    readonly display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}
```

`src` must use the local `game-id/relative/path` asset-ref shape, for example
`<game>/fonts/MyFont-Regular.woff2`. Runtime Google Fonts URLs are forbidden. Font files are
committed only as game-owned assets:

| Purpose                 | Path example                                    |
| ----------------------- | ----------------------------------------------- |
| Game-owned source asset | `apps/<game>/assets/fonts/MyFont-Regular.woff2` |

`renderer/game/GameFontLoader.ts` resolves the local `src` through the app protocol as
`chimera://renderer/game-assets/<game>/fonts/MyFont-Regular.woff2`, loads it with the browser
`FontFace` API, and adds the loaded face to `document.fonts`. The loader deduplicates by family,
source, weight, and style so repeated shell loads do not add duplicate faces.

A game's shell may provide a custom font at weights 400, 700, and 900:

```typescript
export const gameFonts: readonly GameFontFace[] = [
    { family: 'MyFont', src: '<game>/fonts/MyFont-Regular.woff2', weight: '400', display: 'swap' },
    { family: 'MyFont', src: '<game>/fonts/MyFont-Bold.woff2', weight: '700', display: 'swap' },
    { family: 'MyFont', src: '<game>/fonts/MyFont-Black.woff2', weight: '900', display: 'swap' },
];
```

Use `pnpm fetch:fonts -- --game <gameId> --url "<google-css-url>"` as a development-time helper to
download `.woff2` files from a Google Fonts CSS URL into the game asset folder. The helper prints a
`GameFontFace[]` snippet but the runtime never fetches Google-hosted CSS or font files.

The same tool ships as the `chimera-fetch-fonts` bin of `@chimera-engine/electron`
(`electron/dev-tools/fetch-google-fonts/`), so a standalone scaffolded game runs it without the
monorepo — its app-level `fetch:fonts` script invokes
`chimera-fetch-fonts --game <kebab> --out-dir assets/fonts`, forwarded from the project root so
`pnpm fetch:fonts --url "<google-css-url>"` reaches the bin (pnpm appends trailing arguments to the
delegated script). The script bakes in no `--url` placeholder: a package script runs through `sh`,
which reads `<…>` as a redirection, so an inline placeholder made the script die before the bin was
looked up. The optional
`--out-dir` (relative values resolve against the invocation cwd by default) and `--src-prefix`
(must stay a relative asset path) flags default to the monorepo layout
(`apps/<gameId>/assets/fonts`, `<gameId>/fonts`); the scaffolded script passes an explicit
`--out-dir assets/fonts` — the tool's README explains why, and documents the full workflow.

`electron/dev-tools/validate-assets/index.ts` validates every game font declaration before merge: external URLs,
absolute paths, and traversal are rejected; the game-owned source file must exist; and committed
game assets under `renderer/public/assets/` are rejected.

## 4.37.8 Game Menu Command Registry

Games may route buttons to renderer-local command callbacks by declaring a `command` action and
contributing a registry through their renderer shell module. The implementation models this
`GameMenuCommand` registry as a `menuCommands` object keyed by branded `GameMenuCommandId` values:

```typescript
// apps/<name>/shell/main-menu.ts
export const gameMenuCommands: Partial<Record<GameMenuCommandId, () => void>> = {
    ['game:start-tutorial' as GameMenuCommandId]: () => {
        // renderer-local command
    },
};
```

The registry is loaded by `renderer/game/rendererGameRegistry.ts` as part of
`LoadedRendererGameShell`:

```typescript
export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: React.ComponentType;
}
```

`RenderMainMenuDefinition` resolves every `command` action before producing JSX. If a button refers
to a `commandId` that is absent from `menuCommands`, or if no registry was provided, rendering
throws a descriptive error. Unknown commands therefore fail fast instead of producing an inert or
silently missing button.

## 4.37.9 Game-Customizable Shell Background Component

Games may contribute a renderer-owned React component for the shell background through
`LoadedRendererGameShell.shellBackground`. This is intentionally **not** part of
`simulation/foundation/game-shell-contract.ts`: it is a renderer component slot, comparable to `GameScreenRegistry`
presentation slots, and is not serializable data.

```typescript
export interface LoadedRendererGameShell {
    readonly shellBackground?: React.ComponentType;
    readonly shellBackgroundAssets?: AssetManifest;
    readonly shellBackgroundInteractive?: boolean;
}
```

`renderer/components/shell/ShellBackgroundHost.tsx` is mounted once from the root renderer layout
and renders behind route content on the background SURFACES — `main-menu`, `settings`, `lobby` and
every game-declared `page` (§4.37.17) — returning `null` everywhere else. Which surface the current
route is comes off the shell-state store, not from a comparison of its own (§4.37.18). This keeps
shell navigation SPA-like while preventing menu background components from entering the match scene.

### Background Fallback Chain

1. If the current shell route has a game context and the loaded shell provides `shellBackground`,
   render that component.
2. If the loaded shell omits `shellBackground`, shell loading fails, or no game context exists,
   render the engine default solid surface using `--ch-color-surface`.
3. If the current surface is not a background surface (§4.37.17, §4.37.18), render no shell background.

The host passes no props to the game component, and what it does provide it provides by WRAPPING
rather than by prop: the asset session and the pointer-input opt-in below. Everything else a
background needs — its animation, its canvas, its own state — it owns internally. It must not dispatch
gameplay actions or depend on Electron/main-process APIs directly.

### Background Asset Session

A background that renders manifest assets — a model, a sprite sheet, an animation sheet — needs a
game-asset `AssetManager`, and above `GameShell` there is none: the manager in context is the
app-level `DelegatingAssetManager`, which reaches whatever inventory is bound to it at the time
(§4.10).

`shellBackgroundAssets` is the opt-in. When the shell payload declares one, the host wraps the
background component — and only that component — in the same `GameAssetSession` a game-owned page
uses, so `useAsset` / `useModelInstance` / `useAnimationSheet` resolve on `main-menu`, `settings`,
`lobby` and every declared `page`. The session is **keyed to the mount**:

- It is built in a commit-phase effect when the background mounts (Invariant #21), and it runs that
  manifest's critical preload (§4.10), exactly as it does for a page.
- It is disposed when the background unmounts, which the shell-state surface flip off a background
  surface does in one render — so no background session survives into a match, and there is no warm
  cache across `/game`. What that flip is NOT is simultaneous with the router's: `ShellStateBridge`
  publishes the surface from an effect, a commit after the route change, so the match route has
  already committed by the time the background tears down.
- It registers no `SetGameAssetManagerContext` delegate: publishing to a subtree and binding the
  app-level manager are different reaches, and it only ever performs the first.

Declaring it is not required and is not free: a game that omits it renders through the host
unchanged and builds no manager. Declared without a `shellBackground`, it is inert — a session with
no subtree to publish to is never built.

Author the manifest in `apps/<name>/shell-asset-manifest.ts` and forward it from the game's
`renderer/loaders.ts`. That name is how `validate-assets` tells a background inventory from a match
one; what it checks in each is [§4.10 CI Validation](asset-reference-system.md#ci-validation)'s.

Shell page canvases should not paint an opaque full-viewport surface when the background is meant to
be visible. Individual panels, cards, and controls should continue to use raised surface tokens for
readability.

### Interactive Background

`shellBackgroundInteractive?: boolean` opts a background into taking pointer input. Absent or
`false` is the inert-decor contract every painted backdrop stays on: `pointer-events: none` and
`aria-hidden="true"` on the host. `true` flips both together — a region that accepts clicks must not
be hidden from assistive tech, so the two are never separated — and it is answered by the game's own
SUBTREE, not by the flag: declared over the engine's plain coloured plate it stays inert, because
there is nothing to click and nothing worth exposing.

The AT surface the dropped `aria-hidden` exposes is the host element itself — a role-less, unnamed
`<div>` wrapping the game's own subtree. The engine gives it no role and no name, because it does
not know what the background is: naming a scene "background" for a screen-reader user is worse than
not naming it. A game that makes a background clickable owes the accessible names and roles on
whatever inside it is clickable, exactly as it would for any other game surface.

**The flag alone clears no path to the background.** A box with `pointer-events: auto` is a hit
target over its whole area whether or not it paints anything, and two boxes sit above the
background: `ShellContentLayer` (the `--ch-z-raised` frame every route's content renders inside) and
the page's own container. Neither is sized to the viewport by declaration — the frame grows to its
content, and its content on a menu route is a page that is. Measured in the Electron renderer on
`/main-menu`, with the menu alone made click-through: `document.elementFromPoint` at an empty corner
returns the CONTENT LAYER. So the opt-in is honoured by three layers, each standing aside for
itself:

| Layer                 | Under the opt-in                                      | Restores                                                         |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `ShellBackgroundHost` | `pointer-events: auto`, no `aria-hidden`              | —                                                                |
| `ShellContentLayer`   | `pointer-events: none`                                | nothing — see below                                              |
| the route's page      | `pointer-events: none` on its full-viewport container | `auto` on the controls (`main-menu` uses `> *`, by construction) |

`ShellContentLayer` restores nothing on purpose, so the rule for everything it holds is: **a surface
that must stay usable states its own `pointer-events: auto`, where that surface lives.** It is not a
list kept in step in the frame — a blanket `> *` restore there would re-block the very click it just
let through, and it could not know the markup of a game-owned page anyway. What that costs is that a
surface added inside the frame and given no such declaration is unusable under the opt-in and
nowhere else, which is why each one is pinned beside itself rather than by a sentence here.

**A game-owned page owns its own pass-through.** It is the top layer on its own route, so a route a
game ships is click-through only where the page says so. The engine's `main-menu` construction is
the pattern to copy: `pointer-events: none` on the full-viewport container, `auto` restored on the
direct children with `> *` so whatever the page grows next is clickable the day it is added.

The table's page row is not what happens on every background surface. `settings` and `lobby` are
background surfaces whose pages render inside a `Modal`, and the modal overlay is `position: fixed`,
`inset: 0` and now `pointer-events: auto` — so it covers the viewport and the background gets no
clicks there at all, opt-in or not. That is the intended reading of a modal, not a gap: a dialog is
meant to own the screen while it is open.

The engine's three readers — the host, the content layer and `main-menu` — take the opt-in from one
function, `useShellBackgroundPayload`, so the DERIVATION is shared even though each keeps its own
state and its own load. It is engine-internal and reaches no barrel: a game does not read it, and
does not need to, because a game that opts in knows statically that it did. It answers `false` on any surface that carries no background,
including the match, which is what keeps the content layer from standing aside over a HUD.

Inside the canvas nothing changes: r3f keeps its own inline `pointer-events: auto` wrapper, and
`GameCanvas`'s `onPointerMissed` and `ThreeEvent` handlers work as they do in a match.

## 4.37.10 Game-Customizable Settings Page Definition

Games customize which settings appear on the engine-owned settings page by contributing a
declarative `GameSettingsPageDefinition` through their renderer shell registration. The shared
contract lives in `simulation/foundation/game-shell-contract.ts`, so `renderer/` and `apps/*` can
both depend on the type without creating a renderer-to-game static import.

The settings page remains renderer-owned. Games declare tabs, sections, fields, labels, and control
metadata; they do not contribute React components, import renderer UI primitives, or bypass the
settings IPC/store lifecycle from §4.13.

```typescript
export type EngineSettingsFieldId =
    | 'audio.masterVolume'
    | 'audio.sfxVolume'
    | 'audio.musicVolume'
    | 'audio.muted'
    | 'display.targetFps'
    | 'gameplay.language'
    | 'gameplay.autoSave'
    | 'gameplay.autoSaveIntervalTurns'
    | 'gameplay.showHints'
    | 'gameplay.showPerfHud'
    | 'controls.bindings';

export type SettingsControlDefinition =
    | { readonly type: 'slider'; readonly min: number; readonly max: number; readonly step: number }
    | { readonly type: 'toggle' }
    | {
          readonly type: 'select';
          readonly options: readonly { readonly value: string; readonly label: string }[];
      }
    | { readonly type: 'key-binding' };

export type SettingsItemDefinition =
    | { readonly kind: 'engine-field'; readonly fieldId: EngineSettingsFieldId }
    | {
          readonly kind: 'game-field';
          readonly path: string;
          readonly label: string;
          readonly control: SettingsControlDefinition;
      };

export interface SettingsSectionDefinition {
    readonly id: string;
    readonly label?: string;
    readonly items: readonly SettingsItemDefinition[];
}

export interface SettingsTabDefinition {
    readonly id: string;
    readonly label: string;
    readonly sections: readonly SettingsSectionDefinition[];
}

export interface GameSettingsPageDefinition {
    readonly tabs: readonly SettingsTabDefinition[];
}
```

### Engine Field Semantics

`EngineSettingsFieldId` values are the documented `EngineSettings` paths from §4.13. The controls
namespace exposes `controls.bindings` because key bindings are persisted as
`settings.controls.bindings` (Invariant #66); `controls.rebind` is a UI panel concept and is not a
valid engine settings path.

For `engine-field` entries, the renderer owns the label, default value, and control mapping. For
`game-field` entries, the game supplies `path`, `label`, and `control` explicitly. Per Invariant
#35, a `game-field.path` must be backed by the registered game settings schema and must not target
the engine top-level namespaces. `registerSchema()` does not see page definitions — it inspects
`schema.defaults` only, so it enforces the namespace half of #35, not the `path` half.

The engine field registry is exhaustive for the current `EngineSettings` interface:

| Field id                         | Label                | Control     | Default / notes                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `audio.masterVolume`             | Master Volume        | Slider      | `1`, formatted as a percentage                                                                                                                                                                                                                                                                                                                               |
| `audio.sfxVolume`                | SFX Volume           | Slider      | `1`, formatted as a percentage                                                                                                                                                                                                                                                                                                                               |
| `audio.musicVolume`              | Music Volume         | Slider      | `0.8`, formatted as a percentage                                                                                                                                                                                                                                                                                                                             |
| `audio.muted`                    | Muted                | Toggle      | `false`                                                                                                                                                                                                                                                                                                                                                      |
| `display.targetFps`              | Target FPS           | Select      | `60`; options `30`, `60`, `120`, `0` (uncapped). Applied by pacing the R3F loop, in two halves both wired by `GameCanvas` — the only canvas root a game mounts (Invariant #127), on every `role`: `frameloop={useEngineFrameloop()}` on the `<Canvas>` plus the `FrameRateLimiter` driver inside it. Both halves are engine wiring, not game surface (§4.22) |
| `gameplay.language`              | Language             | Select      | `en-US`; options are the game's declared `translations.languages` (endonyms); the row is hidden when the game declares fewer than two languages                                                                                                                                                                                                              |
| `gameplay.autoSave`              | Auto Save            | Toggle      | `true`                                                                                                                                                                                                                                                                                                                                                       |
| `gameplay.autoSaveIntervalTurns` | Auto Save Interval   | Slider      | `5`, range `1`-`100`, integer turns                                                                                                                                                                                                                                                                                                                          |
| `gameplay.showHints`             | Show Hints           | Toggle      | `true`                                                                                                                                                                                                                                                                                                                                                       |
| `gameplay.showPerfHud`           | Show Performance HUD | Toggle      | `false`                                                                                                                                                                                                                                                                                                                                                      |
| `controls.bindings`              | Controls             | Key-binding | Renders the input rebinding pane (game actions only; `engine:*` hidden)                                                                                                                                                                                                                                                                                      |

Typed game definitions cannot reference unknown engine field ids. Defensive renderer paths that
receive an untyped or stale `engine-field` fail fast instead of silently rendering an inert control.

### Engine Default Tab Set

When no game settings definition is available, the renderer uses the engine default four-tab layout:

| Tab      | Sections | Engine fields                                                                                                                                                             |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio    | Audio    | `audio.masterVolume`, `audio.sfxVolume`, `audio.musicVolume`, `audio.muted`                                                                                               |
| Display  | Display  | `display.targetFps`                                                                                                                                                       |
| Gameplay | Gameplay | `gameplay.language` (hidden for single-language games — so the default Gameplay tab is empty until a game declares ≥2 languages or contributes its own gameplay settings) |
| Controls | Controls | `controls.bindings`                                                                                                                                                       |

There is no partial merge between a game settings definition and the engine default tab set. A
provided `GameSettingsPageDefinition` owns its tab list. It can include any subset of engine fields,
combine engine and game fields in the same section, add game-only tabs, or provide an empty `tabs`
array to render an empty settings surface.

### Settings Page Fallback Chain

The settings page stays engine-owned. A game-provided definition controls only the ordering and
selection of fields that the engine renderer displays. The active settings game context resolves
from explicit URL state first (`?gameId=<id>`), then from the active lobby/session game, then from
the engine default:

1. If a resolved renderer shell provides `settings`, render its tabs and sections.
2. If the loaded shell omits `settings`, use the engine default settings definition.
3. If no game context exists, or shell loading fails, use the engine default settings definition.

When settings is opened with explicit URL game context, the Close action returns to
`/main-menu/?gameId=<id>` so the corresponding game-customized main menu remains active.

### Declaring a Game Settings Page

A game declares its settings page in `apps/<name>/shell/settings-page.ts` and exposes it through
the renderer game registry as `LoadedRendererGame.shell.settings`. A game's definition (e.g.
`apps/<game>/shell/settings-page.ts`) might contribute five tabs: Audio, Display, Gameplay, AI,
and Controls.

```typescript
import type { GameSettingsPageDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

export const gameSettingsPageDefinition: GameSettingsPageDefinition = {
    tabs: [
        {
            id: 'gameplay',
            label: 'Gameplay',
            sections: [
                {
                    id: 'engine-gameplay',
                    label: 'Engine',
                    items: [{ kind: 'engine-field', fieldId: 'gameplay.showPerfHud' }],
                },
                {
                    id: 'game-gameplay',
                    label: 'Game',
                    items: [
                        {
                            kind: 'game-field',
                            path: 'showGrid',
                            label: 'Show Grid',
                            control: { type: 'toggle' },
                        },
                    ],
                },
            ],
        },
    ],
};
```

`game-field.path` is a dot-path into the resolved settings object returned by §4.13. A game that adds
root-level extension keys (`showGrid`, `animationSpeed`, `showDamageNumbers`,
`aiThinkingDelayMs`) does so because its `GameSettings` interface extends `EngineSettings` directly.
Games that nest their own settings may use paths such as `<game>.difficulty` instead.

The registry wiring keeps shell pages free of static game imports:

```typescript
export interface LoadedRendererGameShell {
    readonly mainMenu?: GameMainMenuDefinition;
    readonly menuCommands?: Partial<Record<GameMenuCommandId, () => void>>;
    readonly settings?: GameSettingsPageDefinition;
    readonly shellBackground?: React.ComponentType;
}
```

## 4.37.11 Module Tree

```
simulation/foundation/
└── game-shell-contract.ts     # GameMainMenuDefinition, GameSettingsPageDefinition, shell-page contracts
renderer/
├── game/
│   ├── index.ts                # PUBLIC barrel @chimera-engine/renderer/game — registration seam + page services (§4.37.18)
│   ├── rendererGameRegistry.ts # Dynamic game shell loading; no shell-page apps/* import
│   ├── gameShellAssetSource.ts # Shared local-asset-ref resolver for shell fonts/images/cursors
│   ├── GameFontLoader.ts       # Loads shell.fonts via FontFace (§4.37.7)
│   ├── GameImageWarmup.ts      # Fetches + decodes shell.preloadImages (§4.37.13)
│   └── gameCursorStyles.ts     # Injects shell.cursor as --ch-cursor-* overrides (§4.37.14)
├── shell/
│   ├── renderMainMenuDefinition.tsx # Engine renderer for GameMainMenuDefinition
│   ├── SettingsLanguageSelector.tsx # Store-connected wrapper mounting <LanguageSelector> for gameplay.language (§4.37.10)
│   ├── useActiveShellGameId.ts # Shared active-gameId resolver (i18n + icons; usePathname, export-safe)
│   ├── shellRoutes.ts          # Route vocabulary: normalizer, ShellSurface, ENGINE_ROUTE_SURFACES, classifyShellSurface (§4.37.17, §4.37.18)
│   ├── shellStateStore.ts      # The shell-state store: surface/pathname/gameId/transition/draft (§4.37.18)
│   ├── matchEntryVerbs.ts      # startQuickMatch / continueFromAutosave under the arm-clear protocol (§4.37.18)
│   ├── useShellNavigate.ts     # Context-preserving instant hop, published on the game barrel (§4.37.18)
│   └── resolveMainMenuGameId.ts     # URL game context resolver for main menu
├── hooks/
│   └── useQuickStart.ts        # start / close / continueFromAutosave / hasAutosave facade (§4.37.18)
├── styles/
│   └── tokens.css              # Engine default --ch-* tokens (§4.35)
├── theme/
│   ├── ThemeProvider.tsx       # Provides active shell/game theme to UI components
│   ├── default-theme.ts        # Token-referenced button palette + size map
│   ├── theme-context.ts        # React context object exported for consumers
│   ├── types.ts                # Theme and button palette contract types
│   └── useTheme.ts             # Hook: returns active theme from context
├── components/
│   ├── shell/
│   │   ├── ShellStateBridge.tsx # The SINGLE route-classification site; publishes the shell state (§4.37.18)
│   │   └── ShellBackgroundHost.tsx # Persistent shell-surface background host
│   └── ui/
│       ├── Button.tsx          # Shared across shell pages and match screens
│       ├── LogoVideoScreen.tsx # Boot logo video splash building block (§4.37.15)
│       └── icons/              # <Icon>, ICON_REGISTRY, IconProvider/ActiveGameIconProvider, useActiveGameIcons — game glyphs via shell.icons (§4.37.16)
└── app/
    ├── layout.tsx              # Imports tokens.css globally
    ├── shellPageChrome.tsx     # <ShellPageChrome> for a game's own shell page (§4.37.17)
    ├── logo-screen/
    │   └── page.tsx            # Engine boot logo splash → /main-menu (§4.37.15)
    ├── main-menu/
    │   └── page.tsx            # Uses <Button variant="primary|secondary|danger" />
    ├── lobby/
    │   └── page.tsx            # Chrome-less <Modal size="xl">; entry footer via ModalAction (Close + Host/Join dismiss:false)
    ├── settings/
    │   └── page.tsx            # Chrome-less <Modal size="lg" fixedHeight>; footer Reset (danger, dismiss:false) + Close
    └── saves/
        └── page.tsx            # Chrome-less <Modal size="lg">; footer Close; nested delete-confirm Modal
tools/
└── shell-page-routes.ts        # Static check: every declared shellRoute has a page (§4.37.17)
apps/
└── <game>/
    ├── renderer/app/
    │   └── <route>/page.tsx    # A declared shellRoutes page, in the game's OWN tree (§4.37.17)
    └── shell/
    ├── ShellBackground.tsx # Optional shellBackground component contribution
        ├── main-menu.ts        # Sample GameMainMenuDefinition + menuCommands registry
        └── settings-page.ts    # Optional GameSettingsPageDefinition contribution
```

---

## 4.37.12 Game-Customizable Lobby Screen

A game customizes the in-session lobby by contributing a `LobbyScreen` React component through the
renderer game registry (`GameScreenRegistry.LobbyScreen?: ComponentType<GameLobbyScreenProps>`), plus a
pure `GameLobbySetup` descriptor registered on the main side. The engine renders the contributed screen
inside its lobby dialog (§4.37.4) and routes edits through `useLobbyApi()` → IPC → `LobbyManager`: the
host authors game params, while each player authors only its own seat's attributes (a joined client
forwards its own-seat intent to the host). Peers see seats they do not own read-only, and the agreed
configuration is carried into the match as `snapshot.setup`, projected to every peer verbatim.

The full data and authority contract — `GameLobbySetup` / `GameSetupConfig` / `GameLobbyScreenProps`, the
lobby write path (host-authored game params, owner-authored per-player attributes), the snapshot-setup
projection, the registry composition points, and the Tactics adopter — lives in the
**[Customizable Lobby Contract](customizable-lobby-contract.md)**. It ratifies invariants #99
(host-authored game params / owner-authored player attributes), #100 (no direct privileged writes from
a game lobby screen), and #101 (`snapshot.setup` is public, projected verbatim).

---

## 4.37.13 Game Image Preloading

Large images paint progressively while their bytes stream in and their bitmap decodes — visible
"tearing" scanline slices. A `<link rel="preload">` only moves the _fetch_ earlier; it cannot move
the _decode_, so oversized artwork tears no matter how early it is requested. The engine closes the
gap with two cooperating pieces; use them together for any shell picture (main-menu heroes,
backgrounds, thumbnails).

### `LoadedRendererGameShell.preloadImages` — game-declared warm-up

Games declare shell images to warm through `LoadedRendererGameShell.preloadImages`, the image twin
of `fonts` (§4.37.7). Sources use the same local `game-id/relative/path` asset-ref shape; absolute
paths, protocol-relative URLs, and URL schemes are rejected (shared resolver:
`renderer/game/gameShellAssetSource.ts`).

```typescript
export const gameShell: LoadedRendererGameShell = {
    mainMenu,
    preloadImages: ['<game>/images/menu-hero.png', '<game>/images/menu-backdrop.png'],
};
```

`renderer/game/GameImageWarmup.ts` resolves each ref through the app protocol
(`chimera://renderer/game-assets/<game>/images/menu-hero.png`), fetches it via an off-screen
`Image`, and awaits `img.decode()` — the registry (`loadRendererGame` / `loadRendererGameShell`)
awaits the warm-up alongside `loadGameFonts`, so a declared picture is fetched **and decoded**
during the load rather than on first render. The loader deduplicates by resolved URL across shell loads.
Warm-up is best-effort: a broken ref logs a warning, is dropped from the warmed set (so a later
load retries), and never blocks the shell.

Declare only images the shell shows soon after load — the registry awaits the warm-up, so an
oversized list delays the first shell screen. That wait is bounded: `GAME_SHELL_WARMUP_BUDGET_MS`
releases the load and reports what was still outstanding, so a fetch that is never answered costs a
frame of fallback instead of holding the route (Invariant #133, §4.10).

### `PreloadedImage` — decode-gated rendering (§4.35 UI primitive)

`PreloadedImage` (`renderer/components/ui/PreloadedImage.tsx`, exported through the
`@chimera-engine/renderer/components/ui` barrel per invariant #96) wraps `next/image` and holds the
img at `opacity: 0` until `img.decode()` settles, so the compositor's first paint of the picture is
the complete bitmap — it can never tear, even on a cold cache. It defaults to `priority` (eager
fetch; on statically exported pages Next emits the matching `<link rel="preload">` in `<head>`).
The gate fails open: a rejected decode (broken asset) reveals the img so the failure surfaces
visibly, and environments without `img.decode()` reveal immediately. The caller's `style` is
preserved, including a custom `opacity`, once revealed. The engine boot-smoke page (`/`) renders
its logo through this component.

### Sizing discipline

Neither piece fixes an oversized source: keep shipped shell images near their display size
(≈2× for retina). The engine logo budget is locked by `tools/logo-asset-budget.test.ts`
(≤512 px, ≤400 KB for a 256 px display slot); follow the same ratio for game artwork.

---

## 4.37.14 Per-Game Hardware Cursor

A game replaces the OS mouse cursor with its own textures by declaring
`GameManifest.cursor` (§4.2.1) — a map from the engine cursor roles (`default`, `pointer`,
`disabled`) to game-asset-relative image paths with optional per-role hotspots — and forwarding
that declaration verbatim through its renderer registration as `LoadedRendererGameShell.cursor`.
The renderer never reads `GameManifest`; the registration data is the sole carrier.

```typescript
export const gameShell: LoadedRendererGameShell = {
    mainMenu,
    cursor: manifest.cursor, // e.g. { default: { image: 'cursors/default.png' }, pointer: { image: 'cursors/pointer.png', hotspot: { x: 4, y: 7 } } }
};
```

When the game (shell) loads, the registry (`loadRendererGame` / `loadRendererGameShell`) runs the
shell-internal injector `renderer/game/gameCursorStyles.ts` as a side-effect of registry
initialisation (invariant #93). For each declared role it resolves the texture through the
game-asset protocol (`chimera://renderer/game-assets/<game>/cursors/default.png`, invariant #97),
pre-decodes it through the §4.37.13 image warm-up seam (so a paint that follows the injection does
not flash the system cursor), and overrides the engine token on the document root:

```
--ch-cursor-<role>: url(<resolved-url>) <hotspot-x> <hotspot-y>, <role-fallback>
```

The hotspot defaults to the texture's top-left (`0 0`); the trailing fallback keyword is the
role's engine default (`default` → `auto`, `pointer` → `pointer`, `disabled` → `not-allowed`), so
a texture the OS cannot use degrades to the stock cursor. Because every engine cursor style routes
through the `--ch-cursor-*` tokens (§4.35), one injection covers shell chrome and the R3F canvas
alike — the overrides redefine only existing token names (invariant #85).

Texture paths obey the same local-game-asset policy as font and preload-image refs
(`gameShellAssetSource.ts`): absolute paths, protocol-relative URLs, and URL schemes are rejected
— validated against the raw game-relative path _before_ it is joined with the game id, so a
scheme'd value cannot hide behind the join. A malformed declaration throws before any warm-up or
token write; a texture that merely fails to decode warns and the override still applies (the CSS
fallback covers it). No declaration ⇒ strict no-op: the tokens are left untouched. The injector is
shell-internal — not exported from any renderer barrel (invariant #96); games interact with it
only through their registration data.

---

## 4.37.15 Engine Logo Video Screen

A game brands its packaged boot with an optional **logo screen** — a fully game-owned page shown
before the main menu. The game declares `GameManifest.logoScreen` (§4.2.1) naming the renderer
route of the page; when the declaration is present **and** the build is packaged
(`app.isPackaged`), the Electron main process launches the window into that route instead of
`/main-menu` (`resolveRendererLaunchUrl` in the composition root). No declaration ⇒ boot behaviour
is exactly today's; dev and E2E boots are untouched either way.

The engine deliberately does **not** automate the flow: the logo page owns its entire sequence
(one logo, several `LogoVideoScreen`s chained, or a full intro movie are all just page
implementations) and exits by navigating itself to `/main-menu` via
`withShellGameId(..., resolveShellGameId(...))` so the shell `gameId` survives the hop.

### `LogoVideoScreen` — default-screen building block (§4.35 UI primitive)

`LogoVideoScreen` (`renderer/components/ui/LogoVideoScreen.tsx`, exported through the
`@chimera-engine/renderer/components/ui` barrel per invariant #96) hard-codes the engine's default
flow around a full-window **stretched** (`object-fit: fill`), unmuted, inline-autoplay `<video>`:

```typescript
export type LogoVideoScreenProps = Readonly<{
    src: string;
    durationMs?: number; // watchdog, default LOGO_VIDEO_DEFAULT_DURATION_MS (10 s)
    onDone: () => void;
}>;
```

The component drives the app-level `FadeControl` through `useOptionalFade()`: it snaps the screen
fade to black before first paint (`fadeOut(0)` in a layout effect, the main-menu boot pattern),
eases in with `fadeIn(screenFadeMs())`, then on the **first** of — watchdog timeout, video
`ended`, a keydown (skip-on-input; a mouse click deliberately does **not** skip), video `error`, or
an autoplay rejection — it fades back to black and calls `onDone` exactly once. The error and rejection triggers make the screen
fail open: a missing or corrupt video can never brick a packaged boot. Without a mounted
`FadeProvider` the component degrades to the same flow with no fade (unit tests render it bare).
The watchdog is a safety net for a stalled load — `ended` is the primary exit — but it also
hard-truncates playback, so it must exceed the shipped cut's length.

### `/logo-screen` — the engine default page

`renderer/app/logo-screen/page.tsx` mounts `LogoVideoScreen` with the engine brand video
(`/chimera_logo.mp4`) and navigates to the main menu on completion. The compiled page is
re-exportable as `@chimera-engine/renderer/shell/logo-screen/page` through the existing `./shell/*`
wildcard export — adopting games re-export it as their declared route's page and commit their own
`public/chimera_logo.mp4` copy; a game wanting a custom logo sequence writes its own page instead
(and may still compose `LogoVideoScreen`).

### Asset, budget, and platform notes

The engine brand video ships as committed `renderer/public/` copies following the §4.37.13
boot-logo pattern (invariant #97 keeps game-owned custom logo media on the game-asset protocol
instead). `tools/logo-asset-budget.test.ts` locks each copy's existence, ISO-BMFF `ftyp`
signature, byte budget (≤8 MB — the cap sizes the real brand cut, not the placeholder), and
playback duration (parsed from the `mvhd` box, ≤ `LOGO_VIDEO_DEFAULT_DURATION_MS`, so a real cut
can never be silently hard-truncated by the watchdog). The
renderer CSP carries an explicit `media-src 'self'`, `.gitattributes` marks `*.mp4 binary`, and
unmuted no-gesture autoplay works because Electron's default `autoplayPolicy` is
`no-user-gesture-required` (an autoplay rejection elsewhere lands on the fail-open skip path).

---

## 4.37.16 Game-Contributed UI Icons

A game adds its own glyphs to the engine `<Icon>` by contributing a `GameIconSet` through
`LoadedRendererGameShell.icons`. Unlike the hardware cursor (image files declared in the
`GameManifest` and resolved via the `chimera://` protocol), UI icons are **inline SVG React
content** — the same `IconGlyph` shape the engine's own `ICON_REGISTRY` uses — so they travel on the
renderer shell payload, not the manifest, alongside `translations`/`shellBackground`.

```typescript
export interface LoadedRendererGameShell {
    readonly icons?: GameIconSet; // Readonly<Record<string, IconGlyph>>, keyed `game.<gameId>.<name>`
}

// apps/<game>/shell/icons.tsx — authored on the engine glyph contract (no `fill`)
export const gameIcons = {
    'game.<id>.banner': { viewBox: '0 0 24 24', content: <path d="…" /> },
} as const satisfies GameIconSet;
```

The set reaches `<Icon>` through the same registry indirection as translations, with **no DOM
dispatch** (unlike fonts/images/cursor, an inline glyph needs no async decode): `useActiveGameIcons`
reads `shell.icons` from `loadRendererGameShell`, and the app-wide `ActiveGameIconProvider` (mounted
in `AppShell`) publishes it to `IconContext`. `<Icon>` resolves **game-first, engine-fallback**
(`gameIcons?.[name] ?? ICON_REGISTRY[name]`), so a game glyph renders with the engine's
`fill: currentColor` + `--ch-size-icon` styling — identical to a built-in, including inside an
`<IconButton>` — and a game may re-skin a built-in by re-keying it. An unknown name (no engine or
game glyph) renders nothing and dev-warns rather than crashing; the loader dev-warns on a malformed
set. The public `components/ui` barrel exposes `Icon`, `IconProvider`, and the `GameIconSet` type but
deliberately **withholds** `ICON_REGISTRY` — games consume icons only through `<Icon name>`
(invariants #96, #113). By convention a game namespaces its keys `game.<gameId>.<name>` so a glyph
never silently overrides an engine built-in.

## 4.37.17 Game-Owned Shell Routes

A game may promote its own Next routes to first-class shell pages — a credits screen, an atlas, a
codex — by declaring them on the renderer shell payload:

```typescript
export interface LoadedRendererGameShell {
    readonly shellRoutes?: readonly `/${string}`[];
}
```

Each entry names a **physical page** in the game's own host tree,
`apps/<game>/renderer/app/<route>/page.tsx`. Nothing is generated: the logo-screen and
model-showcase routes already worked this way, and this section makes the pattern supported rather
than incidental. The declaration is what tells the engine that a route it does not ship is
nevertheless part of the shell.

### One declaration, three effects

1. **Background continuity.** A declared route classifies as the `page` surface, which is a
   background surface (§4.37.9), so the same background instance survives
   `/main-menu → /<page> → /settings` rather than remounting per hop.
2. **Match entry.** The renderer's snapshot → `/game` effect (`GameStoreBootstrap`) admits the
   `page` surface, so a match started from a game page carries the player into the scene.
3. **Menu reach.** A `navigate` menu action reaches a declared page as an ordinary instant hop with
   `?gameId=` preserved — the same treatment `/settings` and `/saves` get.

### Route matching

Every comparison normalizes both sides through `normalizeRoutePath` (`renderer/shell/shellRoutes.ts`).
The renderer is a static export with `trailingSlash: true`, so the router reports `/credits/` for a
route declared as `'/credits'`, and the packaged app can serve it as `/credits/index.html`. A raw
`'/credits' === pathname` comparison would never match, and the symptom — a missing background, a
match that never enters — looks nothing like a spelling problem.

`ENGINE_ROUTE_SURFACES` in the same module names the engine's own page tree, and
`ENGINE_OWNED_ROUTES` is exactly its key set. A declared route is by definition one the engine does
not ship, which is what lets `ShellStateBridge` decide whether a route could be a game page
**before** the shell payload carrying the declaration has resolved — and keeps `/game` from paying
for a second shell load.

### The entry allow-set

`GameStoreBootstrap`'s snapshot → `/game` gate is an enumerated union of SURFACES (§4.37.18),
never "everything except the match":

| Surface     | Route                         | Admitted when       |
| ----------- | ----------------------------- | ------------------- |
| `lobby`     | `/lobby`                      | any snapshot phase  |
| `saves`     | `/saves`                      | `phase !== 'lobby'` |
| `main-menu` | `/main-menu`                  | `phase !== 'lobby'` |
| `page`      | a declared `shellRoutes` page | `phase !== 'lobby'` |

The phase condition on the last three is what keeps a return-to-lobby broadcast from bouncing a
menu, a saves browser or a game page through `/game` into the reverse effect's `reset()`. A
deny-list inversion would instead drag the `boot` surface — `/debug`, `/component-gallery` and every
undeclared game route — into a hop none of them asked for.

`shellRoutes` resolves **asynchronously**, so the gate re-evaluates when the payload lands: a reload
straight onto a game page can deliver a live match snapshot before the declaration is known, and a
gate that read the declaration once would leave the player stranded on the page with a match
running.

### Page chrome

`@chimera-engine/renderer/shell/shellPageChrome` exports `ShellPageChrome` — the settings-style
permanently-open modal, so a game page looks like one of the engine's own without importing a
renderer internal. It sits under the same `shell/*` allowance as `gameAssetSession` (Invariant #96)
and is importable only from the app's Next host tree (`apps/<game>/renderer/app/**`). The page owns
its body; geometry, the action row and the exit are declarations, and the default exit returns to
`/main-menu` with the URL's `?gameId=` carried along.

Assets on a game page need nothing new: `GameAssetSession` from
`@chimera-engine/renderer/shell/gameAssetSession` builds, publishes and disposes a real game-asset
manager for a declared manifest outside a match (Invariant #21), exactly as the model-showcase route
already does.

### The static cross-check

A declared route with no physical page cannot be caught at runtime: under `output: 'export'` the
route is simply not emitted, so the navigation is a static 404 the renderer never observes.
`tools/shell-page-routes.ts` therefore checks the two halves against each other statically, and
`tools/shell-page-routes.test.ts` is what runs it (`pnpm test`, and CI with it). It parses each
game's sources for `shellRoutes` declarations off the TypeScript AST and asks the game's own Next
tree which routes it serves. Three things are findings: a declared route the tree does not serve, a
declared route the ENGINE owns (a game page cannot shadow an engine route, so the declaration would
be inert), and an initializer the scan cannot read statically (a computed call, an imported
constant) — the last because a computed declaration would silently switch the check off for that
game.

---

## 4.37.18 Shell State and the Game Page Services

A game's own shell surfaces — a custom page, a live background, a character picker — need to know
what the shell around them is doing, and need one field they can write back. Both go through a
single module-singleton store, `renderer/shell/shellStateStore.ts`:

```typescript
interface ShellState {
    readonly surface: ShellSurface;
    readonly pathname: string;
    readonly gameId: string | null;
    readonly transition: { kind: 'to-match' | 'to-shell'; durationMs: number } | null;
    readonly draft: QuickStartConfig;
}
```

The state is plain data. That is what makes `getShellState()` a read a `useFrame` callback can make
every frame without subscribing — a per-frame read through `useShellState` would re-render the
subscriber on every write it observes.

### One classifier

`ShellStateBridge` (`renderer/components/shell/ShellStateBridge.tsx`), mounted beside
`ShellBackgroundHost` inside `AppShell`'s Suspense boundary, is the **only** module in `renderer/`
that turns a pathname into a surface. A second derivation would agree with the first by review
rather than by construction, and the surface a background mounts on and the surface a navigation
gate admits have to be the same answer.

`renderer/shell/__tests__/route-classification-census.test.ts` is what keeps there being one. It
parses every production module under `renderer/` and takes TWO answers, because neither implies the
other:

- **The classifier arm** — which modules import a pathname-consuming helper from the route
  vocabulary. Exactly one: the bridge.
- **The writer arm** — which modules import `setShellRoute`, and which import
  `armShellTransition` / `clearShellTransition`, from the store. A module calling `setShellRoute`
  with a literal surface imports no vocabulary verb and would pass the classifier arm clean.

Reading a set of already-classified surfaces is deliberately not classification — by the time
anything consults `SHELL_BACKGROUND_SURFACES`, the pathname is gone.

The bridge takes its pathname from `usePathname()` and its game context from
`useSearchParams()`, then publishes in a **layout** effect — React runs those synchronously after
the commit. Publishing an unchanged route notifies nobody, which is what makes running it on every
commit cost one comparison.

The pathname source is `usePathname()` and deliberately NOT `window.location`: Next updates the
history entry in a passive effect after the navigation commits, so during the render that first sees
the new pathname `window.location` still holds the one the player just left — and nothing re-renders
the bridge afterwards. Reading it there leaves the surface on `lobby` across the hop into `/game`,
which is a shell background painted over the match and a reverse gate that never fires.
Normalization handles the export spellings a direct load reports.

### The surfaces

| Surface         | Route(s)                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `main-menu`     | `/main-menu`                                                                                                               |
| `settings`      | `/settings`                                                                                                                |
| `lobby`         | `/lobby`                                                                                                                   |
| `saves`         | `/saves`                                                                                                                   |
| `replays`       | `/replays`                                                                                                                 |
| `replay-player` | `/replays/player`                                                                                                          |
| `match`         | `/game`                                                                                                                    |
| `page`          | a route the active game declared through `shellRoutes` (§4.37.17)                                                          |
| `boot`          | everything else — the initial state, `/`, `/logo-screen`, the engine developer routes, and any undeclared non-engine route |

`replay-player` is split from `replays` because the reverse navigation gate acts on the player
route — a post-game replay opened over a still-live session — and not on the browser; one member for
both would widen a gate that was scoped on purpose. `boot` is the catch-all: what its members share
is that no shell surface belongs to them, so a background does not mount and the navigation gate
does not admit them.

### Who writes what

| Field                             | Written by                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `surface` / `pathname` / `gameId` | `ShellStateBridge` only                                                       |
| `transition`                      | the match-entry flows: the snapshot gate's fade effect, and `matchEntryVerbs` |
| `draft`                           | a game, through `setShellDraft(patch)`                                        |

The game barrel exposes **no** setter for the route fields, so a game reacts to a route change and
never authors one. `renderer/game/__tests__/game-barrel-side-effects.test.ts` derives the
non-member list from the store's own exports rather than typing it out, matched on the verb prefixes
the writers use today.

Reading or reacting to shell state triggers no IPC, advances no tick and dispatches no
`EngineAction` — the discipline Invariant #82 states for the render loop, applied here.

### The transition arm/clear protocol

`transition` is armed the moment a match entry BEGINS — not when it lands — carrying the screen-fade
duration this hop runs on, so a background timing a dolly-in has the whole fade to move. What arms
it: the snapshot gate's fade effect, in both directions, and `underArmedTransition` in
`renderer/shell/matchEntryVerbs.ts`, which every `start-game` / `continue` / `useQuickStart()` entry
runs under.

It clears on ARRIVAL — the store clears a `to-match` transition when the `match` surface is
published, and a `to-shell` one when any other surface is — and on IPC REJECTION.

Arrival is asked on a route CHANGE only, never on a republish of the route already published. That
matters for one real case: the reverse gate arms `to-shell` from the `replay-player` surface, which
already satisfies "not the match", so an arrival test taken on every republish would clear the arm
on the spot and leave a background nothing to move on.

The rejection arm is the load-bearing one: a quick start the main process refuses must not leave a
background dollied into a match that never came, nor make the next unrelated route change read as a
match entry.

### The game barrel page services

`@chimera-engine/renderer/game` (Invariant #96) grew from a registration seam into a curated
barrel. What it adds:

| Export               | What it is                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `useShellState(sel)` | React read through a narrow selector                                       |
| `getShellState()`    | transient read — no subscription, no re-render; the `useFrame` form        |
| `setShellDraft(p)`   | the one game-reachable writer; merges per key                              |
| `useShellNavigate()` | instant hop to a shell route with `?gameId=` carried along                 |
| `useQuickStart()`    | `{ start(config?), close(options?), continueFromAutosave(), hasAutosave }` |

The `draft` is a `QuickStartConfig` and not a free-form bag, so what a character-select page
accumulates is exactly what `start()` can hand to `chimera:lobby:quick-start`. `start()` called with
nothing starts the draft; an explicit config merges over it per key. The draft is read at CALL time
and never subscribed to, so a component that only starts a match does not re-render on every
keystroke a sibling page makes. `hasAutosave` is the opposite by design — it follows the live slot
list, so Continue enables the moment an autosave lands.

Every `useQuickStart()` member REJECTS rather than throwing, including for a missing game context
and a missing preload bridge: a `Promise`-returning method that sometimes throws synchronously
breaks `void start().catch(report)`, which is how a game will call it. The engine's own menu verbs
keep an absent bridge a synchronous throw, so an engine defect reaches the crash fallback instead of
a console line.

`close()` routes through the engine's role-aware leave, so a client disconnects and a host takes
the exit its session mode calls for — back to the lobby it came from, or out of a lobby-less quick
session atomically, autosave included.

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #34  | `SettingsManager.registerSchema()` must be called for a game before `getSettings()` or `updateSettings()` is called. Calling `getSettings` for an unregistered `gameId` returns only engine defaults and logs a warning; a settings page definition selects presentation fields only.                                                                                                                                                                                                                               |
| #35  | The engine top-level namespaces (`audio`, `display`, `gameplay`, `controls`) must reach `registerSchema()` intact — present, an object, owning every engine sub-key; shadowed, partial and missing namespaces are all rejected. `game-field.path` entries must be backed by the registered game settings schema; presentation metadata never admits unregistered settings keys.                                                                                                                                     |
| #36  | Settings remain outside simulation state and the `ActionPipeline`. The settings page edits values through the renderer settings store and `window.__chimera.settings`; any value that affects simulation outcomes belongs in the lobby-agreed `gameParams` map transmitted during lobby setup.                                                                                                                                                                                                                      |
| #80  | `GameShell.tsx` must never import from any `apps/*` path. The `GameScreenRegistry` passed as a prop is the sole coupling point between the engine renderer and a game's React code. Shell-page customization follows the same registry-indirection principle through renderer registry loaders.                                                                                                                                                                                                                     |
| #85  | Game token override files may only redefine tokens declared in `renderer/styles/tokens.css`. Introducing new `--ch-*` custom property names in a game's override file is a module-boundary violation.                                                                                                                                                                                                                                                                                                               |
| #91  | Shell page components (`main-menu`, `lobby`, `settings`, `saves`, `component-gallery`) must not set hardcoded colour, spacing, or radius values in any inline `style` prop. All values must use `var(--ch-*)`.                                                                                                                                                                                                                                                                                                      |
| #92  | Shell pages must use `<Button>` from `renderer/components/ui/Button.tsx` for all interactive actions. Raw `<button>` elements with inline styles are prohibited.                                                                                                                                                                                                                                                                                                                                                    |
| #93  | Game token overrides must not be imported directly by shell page components. They enter the cascade only as side-effects of game registry initialisation (§4.35, §4.36).                                                                                                                                                                                                                                                                                                                                            |
| #94  | Shell pages (`main-menu`, `settings`, `saves`, `component-gallery`) must not import from any `apps/*` path. The lobby page may import `LobbyConfig` helpers but not game-specific screen modules.                                                                                                                                                                                                                                                                                                                   |
| #96  | Game renderer surfaces may import the shared renderer library only through its public barrels, which Invariant #96 enumerates; shell pages continue to receive game customization through renderer registry indirection.                                                                                                                                                                                                                                                                                            |
| #99  | Lobby game params are host-authored; per-player attributes are owner-authored. `LobbyManager.setGameParam()` rejects a non-hosted session; `setPlayerAttribute()` rejects any seat but the caller's own and (for a joined client) forwards the own-seat intent to the host, which applies it to the connection-derived sender seat. Three Zod-validated IPC channels funnel into those verbs; changes broadcast to every peer. (§4.37.12)                                                                           |
| #100 | Game `LobbyScreen` components perform no privileged writes directly — they call the engine-provided `setGameParam` / `setPlayerAttribute` props (routed renderer API → IPC → `LobbyManager`) and never write `lobbyStore`, call `LobbyManager`, or open IPC channels themselves. (§4.37.12)                                                                                                                                                                                                                         |
| #101 | `GameSnapshot.setup` / `PlayerSnapshot.setup` is public host config passed through `StateProjector.project()` verbatim — no owner-only or per-viewer fields — so every viewer's projected snapshot carries an identical `setup`. (§4.37.12)                                                                                                                                                                                                                                                                         |
| #109 | Engine UI motion (Modal/Drawer open-close, button press) is parameterised exclusively by `--ch-*` motion tokens backed by global `ch-*` keyframes in `renderer/styles/animations.css`; games customise it only through token overrides, and all engine motion collapses to instant under `prefers-reduced-motion`. (§4.35 Motion & Animation)                                                                                                                                                                       |
| #113 | Game-contributed UI icons reach `<Icon>` only through the `LoadedRendererGameShell.icons` (`GameIconSet`) registry payload → `useActiveGameIcons` → `ActiveGameIconProvider`/`IconContext`; the engine `<Icon>`/`ICON_REGISTRY` never import `apps/*`/`games/*`, the public barrel withholds `ICON_REGISTRY`, resolution is game-first/engine-fallback, an unknown name renders nothing (dev-warns), and game glyphs carry no `fill` (currentColor), rendering like a built-in inside an `<IconButton>`. (§4.37.16) |
| #139 | Shell state is read-mostly and inert: `ShellStateBridge` alone writes the route fields, the enumerated match-entry flows alone write `transition`, and a game writes only `draft` through `setShellDraft`; reading or reacting to any of it opens no IPC channel, advances no tick and dispatches no `EngineAction`. (§4.37.18)                                                                                                                                                                                     |
| #140 | One confirm surface: a single `ConfirmDialogHost` mounted once by `AppShell`, reached by the declarative `GameMenuConfirm` and the imperative `useConfirmDialog()` alike, displaying one queued question at a time. (§4.37.5, §4.35)                                                                                                                                                                                                                                                                                |

---

## Cross-References

- [GameShell, GameScreenRegistry & UI Design System](gameshell-ui-design-system.md) — §4.35 token catalogue, §4.36 game screen code splitting
- [Settings System](settings-system.md) — §4.13 settings schema, merge, repository, and IPC lifecycle
- [Renderer State Stores](renderer-state-stores.md) — store catalogue, `lobbyConfig`, `useLobbyApi()`
- [Scene Transitions & Fade](scene-transitions-fade.md) — `TransitionOverlay`, `useFade()`
- [Customizable Lobby Contract](customizable-lobby-contract.md) — §4.37.12 game-customizable lobby screen, host-authored game params, `snapshot.setup` projection
- [Quick Start, Session Mode & the Shell Flow Layer](quick-start-and-shell-flow.md) — §4.41 the session half: `QuickStartConfig`, `QuickStartCoordinator`, the `engine.sessionMode` stamp and the Leave fork, `close-session`, the autosave slot contract
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #34–#36, #80, #85, #91–#94, #99–#101, #109, #113, #139, #140
- [M8 Hardening Roadmap](../roadmap-sections/m8-hardening-v0.8.0.md) — F51 game-customizable main menu, F52 game-customizable settings page, F53 customizable lobby
