/**
 * shared/game-shell-contract.ts
 *
 * Shared declarative contract for game-customisable shell pages (F51 — §4.37).
 * Consumed by both renderer/ (to render menus) and games/* (to declare menus).
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 * Task: #616 (F51 — GameMainMenuDefinition contract types)
 *
 * Module boundary (§3 Module Boundary Table): `shared/` must not import from
 * `renderer/` or `games/*`. This module has zero imports — the constraint is
 * structurally enforced.
 */

// ─── Branded types ────────────────────────────────────────────────────────────

/**
 * Opaque identifier for a game-contributed menu command.
 * Games register implementations via `LoadedRendererGame.shell.menuCommands`.
 * Cast with `'myGame:action' as GameMenuCommandId`.
 */
export type GameMenuCommandId = string & { readonly __brand: 'GameMenuCommandId' };

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Declarative layout hints for the main-menu button group.
 * All fields are optional; the renderer applies the documented engine defaults
 * when a field is absent.
 */
export interface GameMainMenuLayout {
    /**
     * Stack direction for the button list.
     * Engine default: `'vertical'`
     */
    readonly orientation?: 'vertical' | 'horizontal';

    /**
     * Cross-axis alignment of the button group within its container.
     * Engine default: `'center'`
     */
    readonly align?: 'center' | 'start' | 'end';

    /**
     * Anchor point on the viewport where the button group is positioned.
     * Engine default: `'center'`
     */
    readonly anchor?:
        | 'center'
        | 'top'
        | 'bottom'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right';

    /**
     * Horizontal offset in pixels from the anchor point.
     * Engine default: `0`
     *
     * **Renderer note (Invariant #91):** when applying this value as an inline
     * style, use `calc(${offsetX}px + 0px)` or a CSS custom property — never
     * a bare hardcoded pixel literal — so the engine token cascade is respected.
     */
    readonly offsetX?: number;

    /**
     * Vertical offset in pixels from the anchor point.
     * Engine default: `0`
     *
     * **Renderer note (Invariant #91):** see `offsetX` — same constraint applies.
     */
    readonly offsetY?: number;

    /**
     * Gap in pixels between consecutive buttons.
     * Engine default: resolved from `--ch-space-sm` design token.
     *
     * **Renderer note (Invariant #91):** apply as a CSS custom property
     * (`--menu-gap: ${gap}px; gap: var(--menu-gap)`) rather than an inline
     * pixel literal, so the value participates in the token cascade and
     * does not constitute a hardcoded spacing value on a shell page component.
     */
    readonly gap?: number;
}

// ─── Action ───────────────────────────────────────────────────────────────────

/**
 * Discriminated union of all actions a main-menu button may trigger.
 * Discriminant field: `type`.
 *
 * Use an exhaustive `switch (action.type)` with an `assertNever` fallthrough
 * to catch unhandled variants at compile time (see the co-located .test.ts).
 */
export type GameMainMenuAction =
    | {
          /** Navigate the renderer to an internal route. */
          readonly type: 'navigate';
          /** Target route path, e.g. `'/settings'` or `'/lobby'`. */
          readonly target: string;
      }
    | {
          /** Quit the application. Equivalent to the engine's built-in Quit button. */
          readonly type: 'quit';
      }
    | {
          /** Open the multiplayer lobby screen. */
          readonly type: 'open-lobby';
      }
    | {
          /** Invoke a game-registered named command (see `GameMenuCommandId`). */
          readonly type: 'command';
          /** Branded identifier for the registered command implementation. */
          readonly commandId: GameMenuCommandId;
      };

// ─── Button ───────────────────────────────────────────────────────────────────

/**
 * A single button entry in the main menu.
 * The renderer maps this to a `<Button>` component from `renderer/components/ui/`.
 * Invariant #92 — only `<Button>` variants from §4.37.2 are permitted.
 */
export interface GameMainMenuButton {
    /** Visible button label text. */
    readonly label: string;

    /** Action triggered when the button is activated. */
    readonly action: GameMainMenuAction;

    /**
     * Visual variant for the `<Button>` component.
     * See §4.37.2 Variant Assignment Guide.
     * When omitted the renderer chooses a sensible default (`'primary'` for
     * the first button, `'secondary'` for navigation, `'danger'` for quit).
     */
    readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

// ─── Definition ───────────────────────────────────────────────────────────────

/**
 * Top-level declarative contract for a game-customised main menu.
 *
 * Games export a value satisfying this type from
 * `games/<name>/shell/main-menu.ts` and contribute it via
 * `LoadedRendererGame.shell.mainMenu`.
 *
 * If a game provides `undefined` instead, the renderer falls back to the
 * engine default definition (also expressed as a `GameMainMenuDefinition`).
 */
export interface GameMainMenuDefinition {
    /**
     * Layout hints for the button group.
     * When omitted all layout fields use engine defaults (see `GameMainMenuLayout`).
     */
    readonly layout?: GameMainMenuLayout;

    /**
     * Ordered list of buttons to render in the menu.
     * An empty array is valid; the renderer will show an empty menu.
     */
    readonly buttons: readonly GameMainMenuButton[];
}
