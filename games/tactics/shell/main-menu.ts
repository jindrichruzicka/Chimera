// games/tactics/shell/main-menu.ts
//
// Tactics main menu definition — F51 §4.37 sample for game customisation.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
// Task: #620
//
// Module boundary (§3 Module Boundary Table): games/* may only import from
// simulation/, ai/, shared/, and own files. This module imports from shared/
// only — it must NEVER import from renderer/*.
//
// Invariants:
//   #80  — Shell pages must never statically import from games/*
//   #94  — Games contribute data through the registry, not shell-page imports

import type {
    GameMainMenuDefinition,
    GameMenuCommandId,
} from '@chimera/shared/game-shell-contract.js';

// ─── Definition ───────────────────────────────────────────────────────────────

/**
 * Tactics main menu definition contributed through the renderer game registry.
 *
 * Layout: vertical stack, anchored to the bottom-center of the viewport,
 * with a 16 px gap (→ var(--ch-space-md) in the engine token cascade).
 */
export const tacticsMainMenuDefinition: GameMainMenuDefinition = {
    layout: {
        orientation: 'vertical',
        align: 'center',
        anchor: 'bottom',
        offsetY: -48,
        gap: 16,
    },
    buttons: [
        {
            label: 'New Game',
            action: { type: 'open-lobby' },
            variant: 'primary',
        },
        {
            label: 'Load Game',
            action: { type: 'navigate', target: '/saves' },
            variant: 'secondary',
        },
        {
            label: 'Settings',
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        {
            label: 'Quit',
            action: { type: 'quit' },
            variant: 'danger',
        },
    ],
} as const;

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Tactics currently uses built-in shell actions only.
 */
export const tacticsMenuCommands: Record<GameMenuCommandId, () => void> = {};
