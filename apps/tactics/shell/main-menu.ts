// apps/tactics/shell/main-menu.ts
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
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import type {
    PerspectiveReplayListBridge,
    ReplayListBridge,
} from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';

// ─── Replay bridge access ───────────────────────────────────────────────────────
//
// The Replays button's availability depends on whether ANY replay exists for
// Tactics — deterministic OR perspective (both are saved only on an explicit save
// from the replay player; neither is written at game-over). Both live behind the
// Chimera preload bridge, which the renderer exposes as `window.__chimera`
// (≡ `globalThis.__chimera` at runtime).
//
// Games may not import `renderer/*` or `electron/*` (module boundary §3), and
// this file is type-checked by the DOM-less root tsconfig (so `window` is not
// available here). We therefore read the bridge off `globalThis`, typed against
// the shared `ReplayListBridge` / `PerspectiveReplayListBridge` contracts — the
// same `list` slices the canonical preload APIs extend, so the two cannot
// silently drift apart.

type ReplayBridge = ReplayListBridge & { readonly perspective: PerspectiveReplayListBridge };

function readReplayBridge(): ReplayBridge | undefined {
    return (globalThis as { __chimera?: { replay: ReplayBridge } }).__chimera?.replay;
}

/** Resolve the entry count for one `list` call, treating any failure as "none". */
async function safeCount(list: (() => Promise<readonly unknown[]>) | undefined): Promise<number> {
    if (list === undefined) {
        return 0;
    }
    try {
        return (await list()).length;
    } catch {
        return 0;
    }
}

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
        anchor: 'center',
        offsetY: 85,
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
            label: 'Replays',
            action: { type: 'navigate', target: '/replays' },
            variant: 'secondary',
            // Disabled until at least one replay — deterministic OR perspective —
            // has been saved for Tactics. A missing/failing bridge resolves to "no
            // replays" and the renderer renders the button disabled (fail-safe).
            disabled: async (): Promise<boolean> => {
                const replay = readReplayBridge();
                const [deterministic, perspective] = await Promise.all([
                    safeCount(replay === undefined ? undefined : () => replay.list('tactics')),
                    safeCount(
                        replay === undefined ? undefined : () => replay.perspective.list('tactics'),
                    ),
                ]);
                return deterministic === 0 && perspective === 0;
            },
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
