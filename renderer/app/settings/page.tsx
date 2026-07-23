'use client';

/**
 * renderer/app/settings/page.tsx
 *
 * Settings page — renders engine-owned settings tabs from the shared
 * GameSettingsPageDefinition contract.
 *
 * Architecture reference: §4.13 — Settings System, §4.37.9 — Settings page
 * definition fallback chain.
 *
 * Rules:
 *   - Reads settings from `useSettingsStore()` via narrow typed selectors only.
 *   - All writes go through `window.__chimera.settings` (update / reset).
 *   - Must NOT import from: electron/main/, simulation/, networking/, games/*.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import type {
    EngineSettingsFieldId,
    GameSettingsPageDefinition,
    SettingsControlDefinition,
    SettingsItemDefinition,
    SettingsTabDefinition,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type { ResolvedSettings } from '@chimera-engine/simulation/bridge/api-types.js';
import { useEscapeLayer } from '../../components/shell/EscapeStack';
import { Button } from '../../components/ui/Button';
import { Caption } from '../../components/ui/Caption';
import { Heading } from '../../components/ui/Heading';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { Slider } from '../../components/ui/Slider';
import { Spinner } from '../../components/ui/Spinner';
import { Tabs } from '../../components/ui/Tabs';
import { Toggle } from '../../components/ui/Toggle';
import { loadRendererGame } from '../../game/rendererGameRegistry';
import { ENGINE_SETTINGS_GAME_ID } from '../../input/KeyBindingRepository.js';
import { useInputManager } from '../../input/InputManagerContext.js';
import { useInputActionRegistry } from '../../input/InputActionRegistryContext.js';
import { emitRendererError } from '../../logging/rendererLogger';
import type { InputAction, InputActionId } from '../../input/InputAction.js';
import type { KeyBinding } from '../../input/InputBindingSchema.js';
import { SETTINGS_KEYS } from '../../i18n/engine-keys';
import type { TranslateFn } from '../../i18n/i18n-context';
import { useTranslate } from '../../i18n/useTranslate';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';
import {
    SettingsLanguageSelector,
    useDeclaredLanguages,
} from '../../shell/SettingsLanguageSelector';
import { useSettingsStore } from '../../state/settingsStore';
import {
    getSettingsApi,
    hydrateActiveGameSettings,
    registerActiveGameInputActions,
} from '../settingsGameContext';
import styles from './page.module.css';

type SettingPrimitive = boolean | number | string;

// The slider value-caption formatters, keyed language-agnostically. Each kind is
// resolved to a `(value) => string` at render through the active `t()`
// (makeValueFormatter): the pure descriptor stays free of English.
type ValueFormatterKind = 'percent' | 'turns';

type EngineFieldDefinition = Readonly<{
    readonly control: SettingsControlDefinition;
    readonly defaultValue?: unknown;
    readonly formatKind?: ValueFormatterKind | undefined;
    /** Engine translation token for the field label, resolved through `t()` at render. */
    readonly label: string;
    readonly parseValue?: ((value: SettingPrimitive) => unknown) | undefined;
    readonly testId?: string | undefined;
}>;

type SettingsDefinitionResource = Readonly<{
    read(): GameSettingsPageDefinition;
}>;

// Tab and section labels are engine translation TOKENS, not literal English:
// they are resolved through `t()` at the render site so a game can relabel them
// by re-keying `engine.settings.*`, and the pure default stays language-agnostic.
// A game-provided definition already carries final display strings.
const ENGINE_DEFAULT_SETTINGS_DEFINITION: GameSettingsPageDefinition = {
    tabs: [
        {
            id: 'audio',
            label: SETTINGS_KEYS.tabAudio,
            sections: [
                {
                    id: 'audio',
                    label: SETTINGS_KEYS.tabAudio,
                    items: [
                        { kind: 'engine-field', fieldId: 'audio.masterVolume' },
                        { kind: 'engine-field', fieldId: 'audio.sfxVolume' },
                        { kind: 'engine-field', fieldId: 'audio.musicVolume' },
                        { kind: 'engine-field', fieldId: 'audio.muted' },
                    ],
                },
            ],
        },
        {
            id: 'display',
            label: SETTINGS_KEYS.tabDisplay,
            sections: [
                {
                    id: 'display',
                    label: SETTINGS_KEYS.tabDisplay,
                    items: [{ kind: 'engine-field', fieldId: 'display.targetFps' }],
                },
            ],
        },
        {
            id: 'gameplay',
            label: SETTINGS_KEYS.tabGameplay,
            sections: [
                {
                    id: 'gameplay',
                    label: SETTINGS_KEYS.tabGameplay,
                    // The engine ships no player-facing gameplay toggles by default —
                    // a game registers its own via its GameSettingsPageDefinition
                    // (§4.37.10; see the tactics adopter). Only the language selector
                    // remains, and it hides itself for single-language games, so the
                    // default gameplay tab is empty until a game declares ≥2 languages
                    // or contributes its own gameplay settings.
                    items: [{ kind: 'engine-field', fieldId: 'gameplay.language' }],
                },
            ],
        },
        {
            id: 'controls',
            label: SETTINGS_KEYS.tabControls,
            sections: [
                {
                    id: 'controls',
                    label: SETTINGS_KEYS.tabControls,
                    items: [{ kind: 'engine-field', fieldId: 'controls.bindings' }],
                },
            ],
        },
    ],
};

// Option labels are engine translation TOKENS: resolved through `t()` when the
// <Select> renders (SettingsControl), never English here. `value` is the
// persisted setting and stays literal.
const TARGET_FPS_OPTIONS = [
    { value: '30', label: SETTINGS_KEYS.fps30 },
    { value: '60', label: SETTINGS_KEYS.fps60 },
    { value: '120', label: SETTINGS_KEYS.fps120 },
    { value: '0', label: SETTINGS_KEYS.fpsUncapped },
] as const;

// `label` holds an engine translation TOKEN and `formatKind` names a value
// formatter — both resolved through `t()` at render; the descriptor carries no
// English.
const ENGINE_FIELD_DEFINITIONS: Record<EngineSettingsFieldId, EngineFieldDefinition> = {
    'audio.masterVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 1,
        formatKind: 'percent',
        label: SETTINGS_KEYS.masterVolume,
        testId: 'master-volume',
    },
    'audio.sfxVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 1,
        formatKind: 'percent',
        label: SETTINGS_KEYS.sfxVolume,
    },
    'audio.musicVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 0.8,
        formatKind: 'percent',
        label: SETTINGS_KEYS.musicVolume,
    },
    'audio.muted': {
        control: { type: 'toggle' },
        defaultValue: false,
        label: SETTINGS_KEYS.muted,
    },
    'display.targetFps': {
        control: { type: 'select', options: TARGET_FPS_OPTIONS },
        defaultValue: 60,
        label: SETTINGS_KEYS.targetFps,
        parseValue: parseIntegerValue,
    },
    // The language field is not rendered from this descriptor — renderSettingsItem
    // special-cases 'gameplay.language' to <SettingsLanguageSelector>, which sources
    // its options from the game's declared languages and hides itself when <2. The
    // entry stays because ENGINE_FIELD_DEFINITIONS is exhaustive over every field id;
    // the empty option list is never read.
    'gameplay.language': {
        control: { type: 'select', options: [] },
        defaultValue: 'en-US',
        label: SETTINGS_KEYS.language,
    },
    'gameplay.autoSave': {
        control: { type: 'toggle' },
        defaultValue: true,
        label: SETTINGS_KEYS.autoSave,
    },
    'gameplay.autoSaveIntervalTurns': {
        control: { type: 'slider', min: 1, max: 100, step: 1 },
        defaultValue: 5,
        formatKind: 'turns',
        label: SETTINGS_KEYS.autoSaveInterval,
    },
    'gameplay.showHints': {
        control: { type: 'toggle' },
        defaultValue: true,
        label: SETTINGS_KEYS.showHints,
    },
    'gameplay.showPerfHud': {
        control: { type: 'toggle' },
        defaultValue: false,
        label: SETTINGS_KEYS.showPerfHud,
    },
    'controls.bindings': {
        control: { type: 'key-binding' },
        label: SETTINGS_KEYS.controlsField,
    },
};

/**
 * Cache of per-game settings definition resources. Each resource is created once
 * and reused across renders for the same gameId. The throw-to-suspend pattern
 * requires a stable thrown thenable reference and relies on the cached resolved
 * resource being reused on subsequent renders — clearing this cache between tests
 * forces React to suspend with a fresh pending resource and the re-render triggered
 * by promise resolution does not reliably fire after RTL `cleanup()`. Use a unique
 * gameId per test scenario that requires a distinct definition; do NOT call
 * `_clearSettingsDefinitionCacheForTest()` in afterEach.
 *
 * Note: `React.use(promise)` is the idiomatic React 19 equivalent, but it requires
 * all promise resolutions to occur inside an awaited `act()` scope. The throw-to-
 * suspend pattern is kept to avoid restructuring every RTL helper in the test suite.
 */
const settingsDefinitionResources = new Map<string, SettingsDefinitionResource>();

/** @internal Test-only: clears the per-game definition resource cache. */
export function _clearSettingsDefinitionCacheForTest(): void {
    settingsDefinitionResources.clear();
}

function selectActiveGameId(state: { activeGameId: string | null }): string | null {
    return state.activeGameId;
}

export default function SettingsPage(): React.ReactElement {
    const t = useTranslate();
    const router = useRouter();
    const urlGameId = useUrlGameId();
    const storedActiveGameId = useSettingsStore(selectActiveGameId);
    const activeGameId = urlGameId === undefined ? undefined : (urlGameId ?? storedActiveGameId);
    const gameId = activeGameId ?? ENGINE_SETTINGS_GAME_ID;
    const resolvedSettings = useSettingsStore((state) => state.settings[gameId]);
    const inputManager = useInputManager();
    const inputActionRegistry = useInputActionRegistry();

    const [capturingId, setCapturingId] = React.useState<InputActionId | null>(null);
    const capturedBindingsRef = React.useRef<Partial<Record<InputActionId, KeyBinding>>>({});
    const [rebindStatus, setRebindStatus] = React.useState<
        Partial<Record<InputActionId, { ok: boolean; conflict?: InputActionId }>>
    >({});

    const cancelCapture = React.useCallback(() => {
        setCapturingId(null);
    }, []);
    // While capturing a key binding, this layer registers ABOVE the page Modal's
    // layer (it activates later), so the shared EscapeStack routes Escape here:
    // the capture cancels and the settings modal stays open. It also makes the
    // Modal's Tab trap inert, so Tab is capturable as a binding.
    useEscapeLayer(cancelCapture, capturingId !== null);

    const actionsByCategory = groupActionsByCategory(
        inputManager.getActions().filter((action) => !isEngineAction(action)),
    );

    React.useEffect(() => {
        if (urlGameId === undefined || urlGameId === null) {
            return;
        }

        let disposed = false;
        const settingsApi = getSettingsApi();
        const settingsPromise = hydrateActiveGameSettings(settingsApi, urlGameId, () => disposed);
        const inputActionsPromise = registerActiveGameInputActions(
            inputActionRegistry,
            urlGameId,
            () => disposed,
        );

        void Promise.allSettled([settingsPromise, inputActionsPromise]).then(() => {
            if (!disposed) {
                useSettingsStore.getState().setActiveGameId(urlGameId);
            }
        });

        return () => {
            disposed = true;
        };
    }, [inputActionRegistry, urlGameId]);

    const handleRebind = React.useCallback(
        (id: InputActionId, binding: KeyBinding): void => {
            inputManager
                .rebind(id, binding)
                .then((result) => {
                    if (result.ok) {
                        setRebindStatus((previous) => ({ ...previous, [id]: { ok: true } }));
                    } else if (result.reason === 'conflict') {
                        setRebindStatus((previous) => ({
                            ...previous,
                            [id]: { ok: false, conflict: result.conflictingAction },
                        }));
                    } else {
                        setRebindStatus((previous) => ({ ...previous, [id]: { ok: false } }));
                    }
                })
                .catch((error: unknown) => {
                    // Invariant #67: forward with the Error's stack and a named
                    // module (not 'global'). emitRendererError alone — console.*
                    // is forwarded too, so a console call here would double the
                    // entry. This convention holds for every catch in this
                    // component.
                    const logsApi = (
                        globalThis as Record<string, unknown> & {
                            __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                        }
                    ).__chimera?.logs;
                    emitRendererError(
                        logsApi,
                        '[SettingsPage] rebind failed',
                        error instanceof Error ? error : new Error(String(error)),
                        undefined,
                        'settings-page',
                    );
                });
        },
        [inputManager],
    );

    React.useEffect(() => {
        if (capturingId === null) return;
        const actionId = capturingId;

        function handleKeyDown(event: KeyboardEvent): void {
            event.preventDefault();
            event.stopPropagation();

            // Defensive only: in practice the EscapeStack layer registered above
            // consumes Escape first (window capture phase). Kept so Escape can
            // never be bound as a key if that ordering ever changes.
            if (event.code === 'Escape') {
                setCapturingId(null);
                return;
            }

            const modifiers: ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[] = [];
            if (event.ctrlKey) modifiers.push('Ctrl');
            if (event.shiftKey) modifiers.push('Shift');
            if (event.altKey) modifiers.push('Alt');
            if (event.metaKey) modifiers.push('Meta');

            const binding: KeyBinding = { primary: event.code, modifiers };
            capturedBindingsRef.current[actionId] = binding;
            setCapturingId(null);
            handleRebind(actionId, binding);
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [capturingId, handleRebind]);

    function handleForceRebind(id: InputActionId, conflictingId: InputActionId): void {
        const binding = capturedBindingsRef.current[id];
        if (!binding) return;
        inputManager
            .resetBinding(conflictingId)
            .then(() => inputManager.rebind(id, binding))
            .then((result) => {
                if (result.ok) {
                    setRebindStatus((previous) => ({ ...previous, [id]: { ok: true } }));
                } else {
                    setRebindStatus((previous) => ({ ...previous, [id]: { ok: false } }));
                }
            })
            .catch((error: unknown) => {
                const logsApi = (
                    globalThis as Record<string, unknown> & {
                        __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                    }
                ).__chimera?.logs;
                emitRendererError(
                    logsApi,
                    '[SettingsPage] force-rebind failed',
                    error instanceof Error ? error : new Error(String(error)),
                    undefined,
                    'settings-page',
                );
            });
    }

    function handleResetBinding(id: InputActionId): void {
        inputManager
            .resetBinding(id)
            .then(() => {
                setRebindStatus((previous) => {
                    const next = { ...previous };
                    delete next[id];
                    return next;
                });
            })
            .catch((error: unknown) => {
                const logsApi = (
                    globalThis as Record<string, unknown> & {
                        __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                    }
                ).__chimera?.logs;
                emitRendererError(
                    logsApi,
                    '[SettingsPage] resetBinding failed',
                    error instanceof Error ? error : new Error(String(error)),
                    undefined,
                    'settings-page',
                );
            });
    }

    function handleUpdate(patch: Record<string, unknown>): void {
        useSettingsStore
            .getState()
            .updateSettings(gameId, patch)
            .catch((error: unknown) => {
                const logsApi = (
                    globalThis as Record<string, unknown> & {
                        __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                    }
                ).__chimera?.logs;
                emitRendererError(
                    logsApi,
                    '[SettingsPage] Failed to update settings',
                    error instanceof Error ? error : new Error(String(error)),
                    undefined,
                    'settings-page',
                );
            });
    }

    function handleReset(): void {
        useSettingsStore
            .getState()
            .resetSettings(gameId)
            .catch((error: unknown) => {
                const logsApi = (
                    globalThis as Record<string, unknown> & {
                        __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
                    }
                ).__chimera?.logs;
                emitRendererError(
                    logsApi,
                    '[SettingsPage] Failed to reset settings',
                    error instanceof Error ? error : new Error(String(error)),
                    undefined,
                    'settings-page',
                );
            });
    }

    function handleClose(): void {
        router.push(withShellGameId('/main-menu', activeGameId ?? null));
    }

    function renderControlsPanel(): React.ReactElement {
        if (actionsByCategory.size === 0) {
            return <Caption tone="muted">{t(SETTINGS_KEYS.noControls)}</Caption>;
        }

        return (
            <div className={styles['controls-panel']}>
                {Array.from(actionsByCategory.entries()).map(([category, actions]) => (
                    <section className={styles['controls-category']} key={category}>
                        {actionsByCategory.size > 1 && (
                            <Heading level={3} size="md">
                                {resolveLabel(t, category)}
                            </Heading>
                        )}
                        <div className={styles['binding-list']}>
                            {actions.map((action) => {
                                const binding = inputManager.getBinding(action.id);
                                const status = rebindStatus[action.id];
                                const isCapturing = capturingId === action.id;
                                return (
                                    <div
                                        className={styles['binding-row']}
                                        data-action-id={action.id}
                                        data-testid="binding-action-row"
                                        key={action.id}
                                    >
                                        <span
                                            className={styles['action-description']}
                                            data-testid="binding-description"
                                        >
                                            {/* May be a game/engine translation token; a
                                                literal description falls back to itself. */}
                                            {resolveLabel(t, action.description)}
                                        </span>
                                        <span
                                            className={styles['binding-value']}
                                            data-testid="binding-value"
                                        >
                                            {isCapturing
                                                ? t(SETTINGS_KEYS.pressKey)
                                                : formatBinding(t, binding)}
                                        </span>
                                        {status !== undefined && !status.ok && status.conflict && (
                                            <span className={styles['conflict-status']}>
                                                {t(SETTINGS_KEYS.conflictWith)}
                                                {/* Descriptions may be translation tokens
                                                    (engine actions surface here too). */}
                                                {resolveLabel(
                                                    t,
                                                    inputManager
                                                        .getActions()
                                                        .find(
                                                            (candidate) =>
                                                                candidate.id === status.conflict,
                                                        )?.description ?? status.conflict,
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() =>
                                                        handleForceRebind(
                                                            action.id,
                                                            status.conflict!,
                                                        )
                                                    }
                                                >
                                                    {t(SETTINGS_KEYS.unbindAndRebind)}
                                                </Button>
                                            </span>
                                        )}
                                        {status?.ok === true && (
                                            <span className={styles['success-status']}>
                                                {t(SETTINGS_KEYS.rebindSaved)}
                                            </span>
                                        )}
                                        <div className={styles['binding-actions']}>
                                            {!isCapturing && (
                                                <Button
                                                    className={styles['binding-action-button']}
                                                    data-testid="binding-edit"
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => setCapturingId(action.id)}
                                                >
                                                    {t(SETTINGS_KEYS.editBinding)}
                                                </Button>
                                            )}
                                            <Button
                                                className={styles['binding-action-button']}
                                                data-testid="binding-reset"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleResetBinding(action.id)}
                                            >
                                                {t(SETTINGS_KEYS.resetBinding)}
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        );
    }

    // One Modal for every state (URL-resolving, Suspense-loading, resolved) so
    // the chrome never pops; the fixed height keeps the dialog from resizing
    // when the body swaps.
    return (
        <Modal
            open
            actions={[
                {
                    label: t(SETTINGS_KEYS.reset),
                    variant: 'danger',
                    testId: 'reset-to-defaults',
                    dismiss: false,
                    onClick: handleReset,
                },
                { label: t(SETTINGS_KEYS.close), variant: 'secondary', testId: 'settings-close' },
            ]}
            actionsTestId="settings-dialog-actions"
            data-testid="settings-dialog"
            fixedHeight
            onClose={handleClose}
            size="lg"
            title={t(SETTINGS_KEYS.modalTitle)}
        >
            {activeGameId === undefined ? (
                <div className={styles['loading']}>
                    <Spinner label={t(SETTINGS_KEYS.loading)} />
                </div>
            ) : (
                <React.Suspense
                    fallback={
                        <div className={styles['loading']}>
                            <Spinner label={t(SETTINGS_KEYS.loading)} />
                        </div>
                    }
                >
                    <SettingsDefinitionSurface
                        activeGameId={activeGameId}
                        gameId={gameId}
                        onUpdate={handleUpdate}
                        renderControlsPanel={renderControlsPanel}
                        resolvedSettings={resolvedSettings}
                        t={t}
                    />
                </React.Suspense>
            )}
        </Modal>
    );
}

function useUrlGameId(): string | null | undefined {
    const [gameId, setGameId] = React.useState<string | null | undefined>(undefined);

    React.useEffect(() => {
        setGameId(resolveShellGameId(new URLSearchParams(window.location.search)));
    }, []);

    return gameId;
}

function SettingsDefinitionSurface({
    activeGameId,
    gameId,
    onUpdate,
    renderControlsPanel,
    resolvedSettings,
    t,
}: Readonly<{
    readonly activeGameId: string | null;
    /** Resolved settings game context (URL → activeGameId → engine default). */
    readonly gameId: string;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly renderControlsPanel: () => React.ReactElement;
    readonly resolvedSettings: ResolvedSettings | undefined;
    readonly t: TranslateFn;
}>): React.ReactElement {
    // Read the game's declared languages once here so a section can tell whether
    // its language field will render anything: the field self-hides for <2
    // languages, which is the common way a section ends up empty. `ready` gates
    // the empty-state decision so it never flashes while languages load.
    const { languages, ready: languageReady } = useDeclaredLanguages(gameId, undefined);
    const hasLanguageChoice = languages.length >= 2;
    const definition = readSettingsDefinition(activeGameId);

    return (
        <Tabs
            ariaLabel={t(SETTINGS_KEYS.tabsAriaLabel)}
            data-testid="settings-tabs"
            tabs={definition.tabs.map((tab) => ({
                id: tab.id,
                label: resolveLabel(t, tab.label),
                panel: (
                    <SettingsTabPanel
                        key={tab.id}
                        gameId={gameId}
                        hasLanguageChoice={hasLanguageChoice}
                        languageReady={languageReady}
                        onUpdate={onUpdate}
                        renderControlsPanel={renderControlsPanel}
                        resolvedSettings={resolvedSettings}
                        t={t}
                        tab={tab}
                    />
                ),
                testId: getSettingsTabTestId(tab.id),
            }))}
        />
    );
}

function SettingsTabPanel({
    gameId,
    hasLanguageChoice,
    languageReady,
    onUpdate,
    renderControlsPanel,
    resolvedSettings,
    t,
    tab,
}: Readonly<{
    readonly gameId: string;
    readonly hasLanguageChoice: boolean;
    readonly languageReady: boolean;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly renderControlsPanel: () => React.ReactElement;
    readonly resolvedSettings: ResolvedSettings | undefined;
    readonly t: TranslateFn;
    readonly tab: SettingsTabDefinition;
}>): React.ReactElement {
    return (
        <div className={styles['tab-panel-content']}>
            {tab.sections.map((section) => {
                const headingId = getSettingsElementId(tab.id, section.id, 'heading');
                // Both labels may be engine tokens (or game literals) — resolve
                // both before the dedup compare so a section heading that repeats
                // the tab label is still suppressed once translated.
                const resolvedTabLabel = resolveLabel(t, tab.label);
                const resolvedSectionLabel =
                    section.label === undefined ? undefined : resolveLabel(t, section.label);
                const shouldRenderHeading = shouldRenderSectionHeading(
                    resolvedTabLabel,
                    resolvedSectionLabel,
                );
                // A section is "empty" when none of its items will render
                // anything the player can act on — either it declares no items,
                // or its only item is the language field with no real choice.
                // Mirror the controls panel's "No controls registered." so an
                // empty section never paints a silent, blank panel.
                const hasVisibleItem = section.items.some((item) =>
                    settingsItemWillRender(item, { hasLanguageChoice, languageReady }),
                );
                return (
                    <section
                        aria-labelledby={shouldRenderHeading ? headingId : undefined}
                        className={styles['settings-section']}
                        data-testid={getSettingsSectionTestId(tab.id, section.id)}
                        key={section.id}
                    >
                        {shouldRenderHeading ? (
                            <Heading id={headingId} level={2} size="lg">
                                {resolvedSectionLabel}
                            </Heading>
                        ) : null}
                        <div className={styles['field-list']}>
                            {hasVisibleItem ? (
                                section.items.map((item) =>
                                    renderSettingsItem({
                                        item,
                                        gameId,
                                        onUpdate,
                                        renderControlsPanel,
                                        resolvedSettings,
                                        t,
                                    }),
                                )
                            ) : (
                                <Caption tone="muted">{t(SETTINGS_KEYS.noSettings)}</Caption>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

/**
 * Whether a settings item will render visible content. Only the language field
 * can render nothing (it self-hides for <2 declared languages); every other item
 * — game fields, other engine fields, and the key-binding item (which owns its
 * own "No controls registered." empty state) — always paints. While the language
 * load is still in flight the field is treated as pending (will render), so the
 * section's empty-state message never flashes before the count is known.
 */
function settingsItemWillRender(
    item: SettingsItemDefinition,
    { hasLanguageChoice, languageReady }: { hasLanguageChoice: boolean; languageReady: boolean },
): boolean {
    if (item.kind === 'engine-field' && item.fieldId === 'gameplay.language') {
        return !languageReady || hasLanguageChoice;
    }
    return true;
}

function shouldRenderSectionHeading(
    tabLabel: string,
    sectionLabel: string | undefined,
): sectionLabel is string {
    const normalizedSectionLabel = sectionLabel?.trim();
    return (
        normalizedSectionLabel !== undefined &&
        normalizedSectionLabel.length > 0 &&
        normalizedSectionLabel.toLowerCase() !== tabLabel.trim().toLowerCase()
    );
}

function renderSettingsItem({
    item,
    gameId,
    onUpdate,
    renderControlsPanel,
    resolvedSettings,
    t,
}: Readonly<{
    readonly item: SettingsItemDefinition;
    readonly gameId: string;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly renderControlsPanel: () => React.ReactElement;
    readonly resolvedSettings: ResolvedSettings | undefined;
    readonly t: TranslateFn;
}>): React.ReactElement | null {
    switch (item.kind) {
        case 'engine-field': {
            // The language field is language-aware: it renders the game's
            // declared languages (endonyms) and hides itself for single-language
            // games. SettingsLanguageSelector owns the label, the languages load,
            // and the <2-languages null-return — so it replaces the whole row
            // (no wrapping field <div>/label) rather than a static <Select>.
            if (item.fieldId === 'gameplay.language') {
                return <SettingsLanguageSelector gameId={gameId} key={item.fieldId} />;
            }
            const definition = ENGINE_FIELD_DEFINITIONS[item.fieldId];
            if (definition.control.type === 'key-binding') {
                return <React.Fragment key={item.fieldId}>{renderControlsPanel()}</React.Fragment>;
            }
            // The engine descriptor stores tokens: resolve the field label, the
            // select option labels, and the value formatter through `t()` before
            // handing final display strings to the presentational control.
            return (
                <SettingsControl
                    control={resolveControlLabels(t, definition.control)}
                    defaultValue={definition.defaultValue}
                    formatValue={makeValueFormatter(t, definition.formatKind)}
                    key={item.fieldId}
                    label={resolveLabel(t, definition.label)}
                    onUpdate={onUpdate}
                    parseValue={definition.parseValue}
                    path={item.fieldId}
                    t={t}
                    testId={definition.testId}
                    value={getValueByPath(resolvedSettings, item.fieldId)}
                />
            );
        }
        case 'game-field':
            // A game field's label and (for a select) its option labels may be
            // the game's own translation-token keys, so they resolve through
            // `t()`; a literal display string falls back to itself unchanged.
            return (
                <SettingsControl
                    control={resolveControlLabels(t, item.control)}
                    key={item.path}
                    label={resolveLabel(t, item.label)}
                    onUpdate={onUpdate}
                    path={item.path}
                    t={t}
                    value={getValueByPath(resolvedSettings, item.path)}
                />
            );
    }
}

function SettingsControl({
    control,
    defaultValue,
    formatValue,
    label,
    onUpdate,
    parseValue,
    path,
    t,
    testId,
    value,
}: Readonly<{
    readonly control: SettingsControlDefinition;
    readonly defaultValue?: unknown;
    readonly formatValue?: ((value: unknown) => string) | undefined;
    readonly label: string;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly parseValue?: ((value: SettingPrimitive) => unknown) | undefined;
    readonly path: string;
    readonly t: TranslateFn;
    readonly testId?: string | undefined;
    readonly value: unknown;
}>): React.ReactElement {
    const elementId = getSettingsElementId('setting', path);
    const controlTestId = testId ?? getSettingsControlTestId(path);

    switch (control.type) {
        case 'slider': {
            const currentValue = coerceNumber(value, coerceNumber(defaultValue, control.min));
            return (
                <div className={styles['field']} data-setting-path={path}>
                    <Slider
                        aria-label={label}
                        data-testid={controlTestId}
                        id={elementId}
                        label={label}
                        max={control.max}
                        min={control.min}
                        step={control.step}
                        value={currentValue}
                        onChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                    {formatValue ? <Caption>{formatValue(currentValue)}</Caption> : null}
                </div>
            );
        }
        case 'toggle': {
            const currentValue = coerceBoolean(value, coerceBoolean(defaultValue, false));
            return (
                <div className={styles['field']} data-setting-path={path}>
                    <Toggle
                        checked={currentValue}
                        data-testid={controlTestId}
                        id={elementId}
                        label={label}
                        onCheckedChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                </div>
            );
        }
        case 'select': {
            const currentValue = coerceSelectValue(value, defaultValue, control.options);
            return (
                <div className={styles['field']} data-setting-path={path}>
                    <Select
                        data-testid={controlTestId}
                        id={elementId}
                        label={label}
                        options={control.options}
                        value={currentValue}
                        onValueChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                </div>
            );
        }
        case 'key-binding':
            return (
                <div
                    className={styles['field']}
                    data-setting-path={path}
                    data-testid={controlTestId}
                >
                    <Caption tone="muted">{t(SETTINGS_KEYS.keyBindingsManaged)}</Caption>
                </div>
            );
    }
}

class PendingSettingsDefinitionError extends Error implements PromiseLike<void> {
    readonly #promise: Promise<void>;

    constructor(promise: Promise<void>) {
        super('Settings definition is still loading.');
        this.name = 'PendingSettingsDefinitionError';
        this.#promise = promise;
    }

    then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
        return this.#promise.then(onfulfilled, onrejected);
    }
}

function createSettingsDefinitionResource(gameId: string): SettingsDefinitionResource {
    let status: 'pending' | 'resolved' = 'pending';
    let definition = ENGINE_DEFAULT_SETTINGS_DEFINITION;
    const promise = loadRendererGame(gameId)
        .then((loadedGame) => {
            definition = loadedGame.shell?.settings ?? ENGINE_DEFAULT_SETTINGS_DEFINITION;
            status = 'resolved';
        })
        .catch(() => {
            definition = ENGINE_DEFAULT_SETTINGS_DEFINITION;
            status = 'resolved';
        });
    const pending = new PendingSettingsDefinitionError(promise);

    return {
        read(): GameSettingsPageDefinition {
            if (status === 'pending') {
                throw pending;
            }
            return definition;
        },
    };
}

function readSettingsDefinition(activeGameId: string | null): GameSettingsPageDefinition {
    if (activeGameId === null) {
        return ENGINE_DEFAULT_SETTINGS_DEFINITION;
    }

    const existing = settingsDefinitionResources.get(activeGameId);
    if (existing) {
        return existing.read();
    }

    const resource = createSettingsDefinitionResource(activeGameId);
    settingsDefinitionResources.set(activeGameId, resource);
    return resource.read();
}

/** Resolve a label that may be an engine translation token (or a game literal). */
function resolveLabel(t: TranslateFn, label: string): string {
    return t(label as unknown as Parameters<TranslateFn>[0]);
}

/**
 * Resolve a control's option labels through `t()` for `select` controls whose
 * options may carry translation tokens (engine field descriptors and game
 * fields alike). Other control kinds have no display strings and pass through
 * unchanged; a literal option label falls back to itself.
 */
function resolveControlLabels(
    t: TranslateFn,
    control: SettingsControlDefinition,
): SettingsControlDefinition {
    if (control.type !== 'select') {
        return control;
    }
    return {
        ...control,
        options: control.options.map((option) => ({
            ...option,
            label: resolveLabel(t, option.label),
        })),
    };
}

/**
 * Build the slider value-caption formatter for a formatter kind, or `undefined`
 * when the field has none. The numeric scaling/rounding stays with the consumer
 * (percent rounds, scale keeps two decimals as a string so the ICU `{n}` echoes
 * it verbatim, turns pluralises) and the token supplies only the surrounding
 * text — so a game bundle can relabel the units.
 */
function makeValueFormatter(
    t: TranslateFn,
    kind: ValueFormatterKind | undefined,
): ((value: unknown) => string) | undefined {
    switch (kind) {
        case undefined:
            return undefined;
        case 'percent':
            return (value) =>
                t(SETTINGS_KEYS.formatPercent, {
                    n: Number((coerceNumber(value, 1) * 100).toFixed(0)),
                });
        case 'turns':
            return (value) => t(SETTINGS_KEYS.formatTurns, { n: coerceNumber(value, 5) });
    }
}

function formatBinding(t: TranslateFn, binding: KeyBinding | undefined): string {
    if (!binding) return t(SETTINGS_KEYS.unbound);
    const modifiers = binding.modifiers?.length ? `${binding.modifiers.join('+')}+` : '';
    return `${modifiers}${binding.primary}`;
}

function parseIntegerValue(value: SettingPrimitive): number {
    return parseInt(String(value), 10);
}

function coerceNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function coerceSelectValue(
    value: unknown,
    defaultValue: unknown,
    options: readonly { readonly value: string }[],
): string {
    const fallbackValue = options[0]?.value ?? '';
    const optionValues = new Set(options.map((option) => option.value));

    for (const candidate of [value, defaultValue, fallbackValue]) {
        if (!isSettingPrimitive(candidate)) continue;
        const normalizedValue = String(candidate);
        if (optionValues.has(normalizedValue)) {
            return normalizedValue;
        }
    }

    return fallbackValue;
}

function isSettingPrimitive(value: unknown): value is SettingPrimitive {
    return ['boolean', 'number', 'string'].includes(typeof value);
}

function getValueByPath(settings: ResolvedSettings | undefined, path: string): unknown {
    if (!settings) return undefined;
    let current: unknown = settings;
    for (const part of path.split('.')) {
        if (!isRecord(current) || !(part in current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function buildPatchFromPath(path: string, value: unknown): Record<string, unknown> {
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) return {};

    let patch: unknown = value;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        patch = { [parts[index]!]: patch };
    }
    return patch as Record<string, unknown>;
}

function getSettingsElementId(...parts: readonly string[]): string {
    return parts
        .join('-')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function getSettingsTabTestId(tabId: string): string {
    return getSettingsElementId('settings-tab', tabId);
}

function getSettingsSectionTestId(tabId: string, sectionId: string): string {
    return getSettingsElementId('settings-section', tabId, sectionId);
}

function getSettingsControlTestId(path: string): string {
    return getSettingsElementId('settings-control', path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Engine-reserved actions (`engine:*`) are never player-rebindable — they are
 * hidden from the Controls panel and only configurable by the game creator
 * through the settings defaults/config layers.
 */
function isEngineAction(action: InputAction): boolean {
    return action.id.startsWith('engine:');
}

function groupActionsByCategory(actions: readonly InputAction[]): Map<string, InputAction[]> {
    const grouped = new Map<string, InputAction[]>();
    for (const action of actions) {
        const categoryActions = grouped.get(action.category);
        if (categoryActions !== undefined) {
            categoryActions.push(action);
        } else {
            grouped.set(action.category, [action]);
        }
    }
    return grouped;
}
