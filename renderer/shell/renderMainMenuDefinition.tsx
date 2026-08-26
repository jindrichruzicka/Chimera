'use client';
// renderer/shell/renderMainMenuDefinition.tsx
//
// Declarative engine menu renderer (§4.37).
// Maps a GameMainMenuDefinition (or undefined) to <Button> components
// with token-based layout. No hardcoded pixel/colour literals (Invariant #91).
// All interactive actions use <Button> from renderer/components/ui/ (Invariant #92).
// Must NOT import from apps/* (Invariant #94).
//
// Two of the actions are engine-implemented rather than routed: `start-game`
// invokes the quick-start verb and `continue` loads the game autosave through
// the ordinary `saves.load` restore funnel. Neither navigates: each issues its
// verb and returns. The hop into the match belongs to GameStoreBootstrap's
// snapshot→/game effect, whose entry allow-set covers /main-menu (§4.37.17).
//
// `continue`'s availability is engine-computed and REACTIVE: it subscribes to
// the save slot list, so a `saves:slot-update` push flips the button without the
// game probing anything.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract

import React, { type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type {
    GameMainMenuAction,
    GameMainMenuButton,
    GameMainMenuDefinition,
    GameMainMenuLayout,
    GameMenuCommandId,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type {
    LobbyAPI,
    QuickStartParams,
    SlotId,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { autosaveSlotId } from '@chimera-engine/simulation/foundation/save-slots.js';
import { Button } from '../components/ui/Button';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import { useScreenFadeNavigate } from '../components/shell/useScreenFadeNavigate';
import { getSystemBridge } from '../bridge/system-bridge';
import { getSavesBridge } from '../hooks/useSavesApi';
import { MENU_KEYS } from '../i18n/engine-keys';
import { useTranslate } from '../i18n/useTranslate';
import type { TranslateFn } from '../i18n/i18n-context';
import { useLobbyStore } from '../state/lobbyStore';
import { selectHasAutosave, useSaveStore } from '../state/saveStore';
import { withShellGameId } from './resolveMainMenuGameId';

// ─── Engine default ───────────────────────────────────────────────────────────
//
// The engine-default button labels are engine translation TOKENS, not literal
// English: they are resolved through `t()` at the render site (below) so a game
// can relabel them by re-keying `engine.menu.*`. A game-provided definition, by
// contrast, already carries final display strings and is rendered verbatim.
// Keeping the tokens here (not the resolved text) keeps this pure-data default
// language-agnostic — the token is translated at the render site.

const ENGINE_DEFAULT_DEFINITION: GameMainMenuDefinition = {
    layout: { orientation: 'vertical', align: 'center', anchor: 'center' },
    buttons: [
        { label: MENU_KEYS.play, action: { type: 'open-lobby' }, variant: 'primary' },
        {
            label: MENU_KEYS.settings,
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        { label: MENU_KEYS.quit, action: { type: 'quit' }, variant: 'danger' },
    ],
};

// ─── Token maps (Invariant #91 — no hardcoded spacing/colour literals) ────────

/**
 * Gap pixel → CSS custom property token mapping.
 * Source: renderer/styles/tokens.css — `--ch-space-*`.
 * Values outside this set throw at render time to reject non-token values.
 */
const GAP_TOKEN_MAP = new Map<number, string>([
    [0, 'var(--ch-space-none)'],
    [4, 'var(--ch-space-xs)'],
    [8, 'var(--ch-space-sm)'],
    [16, 'var(--ch-space-md)'],
    [24, 'var(--ch-space-lg)'],
    [40, 'var(--ch-space-xl)'],
]);

function resolveGapToken(gap: number | undefined): string {
    if (gap === undefined) return 'var(--ch-space-sm)';
    const token = GAP_TOKEN_MAP.get(gap);
    if (!token) {
        throw new Error(
            `[RenderMainMenuDefinition] gap=${gap} does not map to a --ch-space-* token. ` +
                `Valid values: 0, 4, 8, 16, 24, 40.`,
        );
    }
    return token;
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function resolveAlignItems(align: GameMainMenuLayout['align']): CSSProperties['alignItems'] {
    switch (align) {
        case 'start':
            return 'flex-start';
        case 'end':
            return 'flex-end';
        case 'center':
        default:
            return 'center';
    }
}

/**
 * Wrapper element positioning based on anchor.
 * Anchored edges use `var(--ch-space-none)` (resolves to 0) rather than the
 * bare literal `0px` so the value participates in the CSS custom-property
 * cascade (Invariant #91).
 */
function resolveWrapperStyle(anchor: GameMainMenuLayout['anchor']): CSSProperties {
    if (!anchor || anchor === 'center') {
        return { position: 'relative' };
    }

    const style: CSSProperties = { position: 'absolute' };

    if (anchor === 'top' || anchor === 'top-left' || anchor === 'top-right') {
        style.top = 'var(--ch-space-none)';
    }
    if (anchor === 'bottom' || anchor === 'bottom-left' || anchor === 'bottom-right') {
        style.bottom = 'var(--ch-space-none)';
    }
    if (anchor === 'top' || anchor === 'bottom') {
        // Centered on horizontal axis: anchor to both left extremes and shift by 50%
        style.left = '50%';
        style.transform = 'translateX(-50%)';
    }
    if (anchor === 'top-left' || anchor === 'bottom-left') {
        style.left = 'var(--ch-space-none)';
    }
    if (anchor === 'top-right' || anchor === 'bottom-right') {
        style.right = 'var(--ch-space-none)';
    }

    return style;
}

/**
 * Offset transforms use CSS custom properties rather than bare pixel literals
 * (Invariant #91 — no hardcoded spacing values on shell page components).
 * We skip the property entirely when both offsets are zero to avoid emitting
 * no-op transform values.
 */
function resolveOffsetStyle(offsetX: number, offsetY: number): CSSProperties {
    if (offsetX === 0 && offsetY === 0) return {};

    return {
        '--menu-offset-x': `${offsetX}px`,
        '--menu-offset-y': `${offsetY}px`,
        transform: 'translateX(var(--menu-offset-x)) translateY(var(--menu-offset-y))',
    } as CSSProperties;
}

function defaultVariant(
    action: { type: string },
    index: number,
): 'primary' | 'secondary' | 'ghost' | 'danger' {
    if (action.type === 'quit') return 'danger';
    if (index === 0) return 'primary';
    return 'secondary';
}

/**
 * Resolve a declared display string through the active translator. Both the
 * engine default (`engine.menu.*`) and a game-provided definition may store a
 * translation-token key wherever text is declared — a button label, a confirm
 * title, body or control label; text with no matching token falls back to
 * itself, so a literal display string passes through unchanged.
 */
function resolveText(t: TranslateFn, text: string): string {
    return t(text as unknown as Parameters<TranslateFn>[0]);
}

/**
 * Narrow resolver for the quick-start slice of the preload lobby bridge.
 * Deliberately not `getLobbyBridge()` from the lobby page's hook: that helper
 * also demands `__chimera.system`, an unrelated dependency this call never
 * touches (the same reason `useLeaveGame` resolves its own).
 */
function resolveQuickStartApi(): Pick<LobbyAPI, 'quickStart'> | null {
    const bridge = globalThis as { readonly __chimera?: { readonly lobby?: LobbyAPI } };
    const lobby = bridge.__chimera?.lobby;
    return lobby === undefined || typeof lobby.quickStart !== 'function' ? null : lobby;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RenderMainMenuDefinitionProps {
    definition?: GameMainMenuDefinition | undefined;
    gameId?: string | null | undefined;
    menuCommands?: Partial<Record<GameMenuCommandId, () => void>> | undefined;
    getButtonTestId?:
        | ((button: GameMainMenuButton, index: number) => string | undefined)
        | undefined;
}

export function RenderMainMenuDefinition({
    definition,
    gameId = null,
    menuCommands,
    getButtonTestId,
}: RenderMainMenuDefinitionProps): React.ReactElement {
    const router = useRouter();
    const fadeOutThenNavigate = useScreenFadeNavigate();
    const t = useTranslate();
    const requestConfirm = useConfirmDialog();

    // Reactive engine-computed availability (§4.37.5). `continue` follows the
    // live save slot list and the live session, so it enables the moment an
    // autosave lands and disables again the moment one is deleted or a session
    // is joined — no game-side probe, and no resolve-once snapshot to go stale.
    // The selector is rebuilt per render, which `useStore` tolerates because the
    // selected value is a boolean and compares equal across renders.
    const hasAutosave = useSaveStore((state) =>
        gameId === null ? false : selectHasAutosave(gameId)(state),
    );
    // Hydration matters only to `when: 'autosave-exists'`: until the list has
    // arrived, "is there a save to overwrite?" has no answer. With no game there
    // is nothing to list and nothing to overwrite, so that case never waits.
    const saveSlotsLoading = useSaveStore((state) => state.isLoading);
    const autosaveUnknown = gameId !== null && saveSlotsLoading;
    // Covers both roles: a joined client and a host that walked back to the menu
    // both hold a live session.
    const sessionActive = useLobbyStore((state) => state.lobbyState !== null);

    // Every button label is resolved through `t()`, whether it comes from the
    // engine default (`engine.menu.*` tokens) or a game-provided definition (the
    // game's own `game.<id>.menu.*` tokens). A label with no matching token
    // falls back to itself, so a game that still passes a literal display string
    // renders unchanged — the resolution is a no-op for non-token labels.
    const def = definition ?? ENGINE_DEFAULT_DEFINITION;
    const { layout, buttons } = def;

    const displayLabel = (button: GameMainMenuButton): string => resolveText(t, button.label);

    // ── Disabled resolution ─────────────────────────────────────────────────────
    // Buttons may declare `disabled` as a plain boolean or as an async check
    // (e.g. "are there any replays to browse?"). Async checks are evaluated here
    // and their results stored per-index. A button whose async check is still
    // pending renders disabled (fail-safe — avoids a flash of enabled→disabled),
    // and a thrown/rejected check is also treated as disabled and logged at warn.
    const [asyncDisabled, setAsyncDisabled] = React.useState<readonly (boolean | undefined)[]>(() =>
        buttons.map(() => undefined),
    );

    React.useEffect(() => {
        let cancelled = false;
        // Clear any results carried over from a previous definition.
        setAsyncDisabled(buttons.map(() => undefined));

        buttons.forEach((button, index) => {
            const { disabled } = button;
            if (typeof disabled !== 'function') return;

            Promise.resolve()
                .then(() => disabled())
                .then((value) => {
                    if (cancelled) return;
                    setAsyncDisabled((prev) => {
                        const next = prev.slice();
                        next[index] = value;
                        return next;
                    });
                })
                .catch((error: unknown) => {
                    console.warn(
                        '[RenderMainMenuDefinition] disabled() check failed; disabling button (fail-safe).',
                        error,
                    );
                    if (cancelled) return;
                    setAsyncDisabled((prev) => {
                        const next = prev.slice();
                        next[index] = true;
                        return next;
                    });
                });
        });

        return () => {
            cancelled = true;
        };
    }, [buttons]);

    // Engine-owned gates run FIRST and win over a game's own `disabled`: the two
    // engine verbs and the autosave-conditioned confirm are conditions the game
    // cannot see, and a declaration saying `disabled: false` must not be able to
    // offer a Continue with nothing to continue.
    const resolveDisabled = (button: GameMainMenuButton, index: number): boolean => {
        const actionType = button.action.type;
        // The menu is not the surface for acting on a session already in
        // progress.
        if ((actionType === 'continue' || actionType === 'start-game') && sessionActive) {
            return true;
        }
        if (actionType === 'continue' && !hasAutosave) return true;
        if (button.confirm?.when === 'autosave-exists' && autosaveUnknown) return true;
        const { disabled } = button;
        if (typeof disabled === 'boolean') return disabled;
        if (typeof disabled === 'function') return asyncDisabled[index] ?? true;
        return false;
    };

    /**
     * The two engine verbs address one concrete game. Reaching them with no game
     * context is a malformed declaration, not a runtime condition, so it fails
     * fast at render exactly as an unregistered `command` id does — rather than
     * shipping a button whose handler could only no-op.
     */
    const requireGameId = (verb: string): string => {
        if (gameId === null) {
            throw new Error(
                `[RenderMainMenuDefinition] '${verb}' needs an active game; the menu was rendered with no gameId`,
            );
        }
        return gameId;
    };

    // ── Handler resolution ────────────────────────────────────────────────────
    // `command` actions and the two engine verbs fail-fast at render time (an
    // unknown commandId, or a verb with no game context → throw before any JSX
    // is produced). Other action types return a stable handler reference; the
    // handler may throw at call time (e.g. `quit` when the preload bridge is
    // absent — caught by the nearest error boundary).
    //
    // The switch has no `default`: with a declared `() => void` return, a new
    // action variant makes this function fall off its end and TypeScript rejects
    // it, so the contract cannot widen without a decision here.
    const resolveActionRunner = (action: GameMainMenuAction): (() => void) => {
        switch (action.type) {
            case 'open-lobby':
                return (): void => {
                    // menu → lobby are both UI screens: no fade (the fade marks
                    // entering/leaving the game scene, not this hop).
                    router.push(withShellGameId('/lobby', gameId));
                };
            case 'navigate': {
                const target = action.target;
                // Fade only when entering the game scene; everything else from the
                // menu (lobby, settings, saves, replays) is an instant UI hop.
                const fadesIn = target === '/game';
                return (): void => {
                    const doNavigate = (): void => {
                        router.push(withShellGameId(target, gameId));
                    };
                    if (fadesIn) {
                        void fadeOutThenNavigate(doNavigate);
                    } else {
                        doNavigate();
                    }
                };
            }
            case 'quit':
                return (): void => {
                    const system = getSystemBridge();
                    if (!system) throw new Error('Chimera system API not available');
                    system.quit();
                };
            case 'start-game': {
                // Merged over the game's own `GameLobbySetup.quickStart` defaults
                // by the main process; a button that declares nothing starts
                // exactly the match the game declared. The handler issues the
                // verb and returns — see the header on the routing.
                const params: QuickStartParams = {
                    ...(action.config ?? {}),
                    gameId: requireGameId('start-game'),
                };
                return (): void => {
                    const lobby = resolveQuickStartApi();
                    if (!lobby) throw new Error('Chimera lobby API not available');
                    void lobby.quickStart(params).catch((error: unknown) => {
                        console.error(
                            '[RenderMainMenuDefinition] start-game: the quick start was refused.',
                            error,
                        );
                    });
                };
            }
            case 'continue': {
                // The engine picks the slot; the call behind it is the same
                // `saves.load` the saves browser issues, so the whole restore
                // funnel — including the waiting overlay a multiplayer autosave
                // needs — is reused rather than rebuilt.
                const slotId = autosaveSlotId(requireGameId('continue')) as SlotId;
                return (): void => {
                    const saves = getSavesBridge();
                    if (!saves) throw new Error('Chimera saves API not available');
                    void saves.load(slotId).catch((error: unknown) => {
                        console.error(
                            '[RenderMainMenuDefinition] continue: loading the autosave failed.',
                            error,
                        );
                    });
                };
            }
            case 'command': {
                const handler = menuCommands?.[action.commandId];
                if (!handler) {
                    throw new Error(
                        `[RenderMainMenuDefinition] Command '${action.commandId}' is not registered in menuCommands`,
                    );
                }
                return handler;
            }
        }
    };

    // ── Confirmation ──────────────────────────────────────────────────────────
    // A declared `confirm` sits between the click and the action. `always` asks
    // every time; `autosave-exists` asks only while there is a save the action
    // would overwrite — and the button stays disabled until the slot list can
    // answer that (see resolveDisabled), so a first-run player is never told
    // they are about to overwrite a save that does not exist.
    const withConfirmation = (button: GameMainMenuButton, run: () => void): (() => void) => {
        const { confirm } = button;
        if (confirm === undefined) return run;

        return (): void => {
            if (confirm.when === 'autosave-exists' && !hasAutosave) {
                run();
                return;
            }
            void requestConfirm({
                title: resolveText(t, confirm.title),
                ...(confirm.body === undefined ? {} : { body: resolveText(t, confirm.body) }),
                ...(confirm.confirmLabel === undefined
                    ? {}
                    : { confirmLabel: resolveText(t, confirm.confirmLabel) }),
                ...(confirm.cancelLabel === undefined
                    ? {}
                    : { cancelLabel: resolveText(t, confirm.cancelLabel) }),
            })
                .then((accepted) => {
                    if (accepted) run();
                })
                .catch((error: unknown) => {
                    // The action ran inside a promise continuation, so a throw
                    // here would surface as an unhandled rejection instead of
                    // reaching an error boundary. console.error IS the renderer
                    // logging bridge (Invariant #67), so the Error still lands
                    // in the log file with its stack.
                    console.error('[RenderMainMenuDefinition] confirmed action failed.', error);
                });
        };
    };

    const handlers = buttons.map((button) =>
        withConfirmation(button, resolveActionRunner(button.action)),
    );

    // ── Layout ────────────────────────────────────────────────────────────────
    const orientation = layout?.orientation ?? 'vertical';
    const flexDirection: CSSProperties['flexDirection'] =
        orientation === 'horizontal' ? 'row' : 'column';

    const alignItems = resolveAlignItems(layout?.align);
    const gapValue = resolveGapToken(layout?.gap);
    const offsetX = layout?.offsetX ?? 0;
    const offsetY = layout?.offsetY ?? 0;

    const containerStyle: CSSProperties = {
        display: 'flex',
        flexDirection,
        alignItems,
        gap: gapValue,
        ...resolveOffsetStyle(offsetX, offsetY),
    };

    const wrapperStyle = resolveWrapperStyle(layout?.anchor);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div data-testid="menu-wrapper" style={wrapperStyle}>
            <div data-testid="menu-container" style={containerStyle}>
                {buttons.map((button, index) => (
                    <Button
                        key={index}
                        data-testid={getButtonTestId?.(button, index)}
                        variant={button.variant ?? defaultVariant(button.action, index)}
                        disabled={resolveDisabled(button, index)}
                        onClick={handlers[index]}
                    >
                        {displayLabel(button)}
                    </Button>
                ))}
            </div>
        </div>
    );
}
