'use client';
// renderer/shell/renderMainMenuDefinition.tsx
//
// Declarative engine menu renderer (F51 — §4.37).
// Maps a GameMainMenuDefinition (or undefined) to <Button> components
// with token-based layout. No hardcoded pixel/colour literals (Invariant #91).
// All interactive actions use <Button> from renderer/components/ui/ (Invariant #92).
// Must NOT import from games/* (Invariant #94).
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
// Task: #618

import React, { type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type {
    GameMainMenuButton,
    GameMainMenuDefinition,
    GameMainMenuLayout,
    GameMenuCommandId,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import { Button } from '../components/ui/Button';
import { getSystemBridge } from '../bridge/system-bridge';
import { withShellGameId } from './resolveMainMenuGameId';

// ─── Engine default ───────────────────────────────────────────────────────────

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

// ─── Token maps (Invariant #91 — no hardcoded spacing/colour literals) ────────

/**
 * Gap pixel → CSS custom property token mapping.
 * Source: renderer/styles/tokens.css — `--ch-space-*`.
 * Values outside this set throw at render time (issue spec: "reject non-token values").
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

    const def = definition ?? ENGINE_DEFAULT_DEFINITION;
    const { layout, buttons } = def;

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

    const resolveDisabled = (button: GameMainMenuButton, index: number): boolean => {
        const { disabled } = button;
        if (typeof disabled === 'boolean') return disabled;
        if (typeof disabled === 'function') return asyncDisabled[index] ?? true;
        return false;
    };

    // ── Handler resolution ────────────────────────────────────────────────────
    // `command` actions fail-fast at render time (unknown commandId → throw
    // before any JSX is produced). Other action types return a stable handler
    // reference; the handler may throw at call time (e.g. `quit` when the
    // preload bridge is absent — caught by the nearest error boundary).
    const handlers = buttons.map((button) => {
        const { action } = button;
        switch (action.type) {
            case 'open-lobby':
                return (): void => {
                    router.push(withShellGameId('/lobby', gameId));
                };
            case 'navigate':
                return (): void => {
                    router.push(withShellGameId(action.target, gameId));
                };
            case 'quit':
                return (): void => {
                    const system = getSystemBridge();
                    if (!system) throw new Error('Chimera system API not available');
                    system.quit();
                };
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
    });

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
                        {button.label}
                    </Button>
                ))}
            </div>
        </div>
    );
}
