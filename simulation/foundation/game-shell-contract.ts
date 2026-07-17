/**
 * shared/game-shell-contract.ts
 *
 * Shared declarative contract for game-customisable shell pages (§4.37).
 * Consumed by both renderer/ (to render menus) and games/* (to declare menus).
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
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

// ─── Game Fonts ──────────────────────────────────────────────────────────────

export type GameFontStyle = 'normal' | 'italic';

export type GameFontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

/**
 * A self-hosted font face contributed by a concrete game for shell and game UI.
 * `src` uses the same `game-id/relative/path` shape as AssetRef strings and
 * must resolve to a committed file owned by the game under `games/<game>/assets/`.
 */
export interface GameFontFace {
    readonly family: string;
    readonly src: string;
    readonly weight?: string;
    readonly style?: GameFontStyle;
    readonly display?: GameFontDisplay;
}

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

    /**
     * Controls whether the button renders disabled.
     *
     * - `boolean` — a static disabled state evaluated at render time.
     * - `() => Promise<boolean>` — an async availability check the renderer
     *   awaits at render time (e.g. "are there any replays to browse?"). The
     *   button renders disabled while the check is pending; a thrown or rejected
     *   check is treated as `true` (fail-safe — the renderer logs at `warn`).
     *
     * Omitted means the button is always enabled.
     */
    readonly disabled?: boolean | (() => Promise<boolean>);
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

// ─── Settings page contract (§4.13, §4.37) ───────────────────────────────────

/**
 * Exhaustive branded union of every engine setting field that may be referenced
 * in a `SettingsItemDefinition` with `kind: 'engine-field'`.
 *
 * The set is derived from the `EngineSettings` interface (§4.13). Any attempt to
 * use a stale or game-specific path (e.g. `'display.resolution'`, `'tactics.difficulty'`)
 * is rejected by TypeScript.
 *
 * Game-defined fields must use `kind: 'game-field'` with their game settings
 * path. Runtime game schema registration enforces the engine namespace collision
 * guard from invariant #35.
 */
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

/**
 * Discriminated union describing how a settings value is presented in the UI.
 * Discriminant field: `type`.
 *
 * Use an exhaustive `switch (ctrl.type)` with an `assertNever` fallthrough to
 * catch unhandled variants at compile time.
 */
export type SettingsControlDefinition =
    | {
          /** A range slider bound to a numeric value. */
          readonly type: 'slider';
          readonly min: number;
          readonly max: number;
          readonly step: number;
      }
    | {
          /** A boolean checkbox / toggle switch. */
          readonly type: 'toggle';
      }
    | {
          /** A drop-down list of labelled string values. */
          readonly type: 'select';
          readonly options: readonly { readonly value: string; readonly label: string }[];
      }
    | {
          /** An interactive key-capture control for re-binding an action. */
          readonly type: 'key-binding';
      };

/**
 * A single item within a `SettingsSectionDefinition`.
 * Discriminant field: `kind`.
 *
 * - `engine-field` — references a pre-defined engine setting by its `EngineSettingsFieldId`.
 *   The renderer owns the label, default, and control type for these fields.
 * - `game-field`   — a game-defined setting at an arbitrary dot-path. The game supplies the
 *   label and control definition explicitly.
 */
export type SettingsItemDefinition =
    | {
          readonly kind: 'engine-field';
          /** Typed reference to an engine setting field (see `EngineSettingsFieldId`). */
          readonly fieldId: EngineSettingsFieldId;
      }
    | {
          readonly kind: 'game-field';
          /** Dot-path into the resolved settings object (e.g. `'tactics.campaignDifficulty'`). */
          readonly path: string;
          /** Visible label text rendered next to the control. */
          readonly label: string;
          /** Describes how the field value is rendered and edited. */
          readonly control: SettingsControlDefinition;
      };

/**
 * A labelled group of `SettingsItemDefinition` entries within a tab.
 * `label` is optional — a section without a label renders its items without a group heading.
 */
export interface SettingsSectionDefinition {
    readonly id: string;
    readonly label?: string;
    readonly items: readonly SettingsItemDefinition[];
}

/**
 * A single tab in the settings page, containing one or more sections.
 * Both `id` and `label` are required — `id` is used for keying and routing;
 * `label` is displayed in the tab bar.
 */
export interface SettingsTabDefinition {
    readonly id: string;
    readonly label: string;
    readonly sections: readonly SettingsSectionDefinition[];
}

/**
 * Top-level declarative contract for a game-customised settings page.
 *
 * Games export a value satisfying this type from
 * `games/<name>/shell/settings-page.ts` and contribute it via
 * `LoadedRendererGame.shell.settings`.
 *
 * If a game provides `undefined`, the renderer falls back to the engine default
 * definition (the four engine tabs: Audio, Display, Gameplay, Controls).
 */
export interface GameSettingsPageDefinition {
    /**
     * Ordered list of tabs to render. An empty array is valid.
     */
    readonly tabs: readonly SettingsTabDefinition[];
}
