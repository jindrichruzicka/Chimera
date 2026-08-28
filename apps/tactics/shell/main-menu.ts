// apps/tactics/shell/main-menu.ts
//
// Tactics main menu definition — §4.37 sample for game customisation.
//
// Architecture reference: §4.37 — Renderer Shell Pages UI Contract
//
// Module boundary (§3 Module Boundary Table): this module's workspace imports
// are simulation/foundation/ only — it must NEVER import from renderer/*.
//
// Invariants:
//   #94  — Engine shell pages must not import from apps/*

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
// This file is type-checked by the DOM-less root tsconfig (so `window` is not
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
    // Button labels are `game.tactics.menu.*` translation tokens (mirrored in the
    // Tactics bundles). They are stored as plain strings here — this data module is
    // boundary-restricted (no renderer/i18n import), and the engine renderer
    // resolves each label through `t()` at render (an identity for non-token text).
    buttons: [
        // The two lobby-less match entries sit above the lobby flow: a returning
        // player resumes, a new one starts playing, and the lobby stays one click
        // away for a match against another person. Every one of the three is a
        // game start, which §4.37.2 assigns `primary` — the variant carries the
        // kind of action, and the order carries the emphasis.
        //
        // Neither entry declares `disabled`. Both availability answers are
        // engine-computed and reactive (§4.37.5): Continue follows the live save
        // slot list, and both go disabled while a session is live.
        {
            label: 'game.tactics.menu.continue',
            action: { type: 'continue' },
            variant: 'primary',
        },
        {
            // Slug declared because the engine derives `main-menu-start` from the
            // action alone, which would not distinguish a second start if this
            // menu ever grew one.
            id: 'quick-match',
            label: 'game.tactics.menu.quickMatch',
            // Host versus one AI, and nothing else said: the AI seat declares no
            // attributes, so its colour comes from `resolveDefaultPlayerAttributes`
            // exactly as a lobby-added AI's does, and the game params are the
            // ones `buildTacticsLobbySetup` already declares.
            action: { type: 'start-game', config: { aiSeats: [{}] } },
            variant: 'primary',
        },
        {
            label: 'game.tactics.menu.newGame',
            action: { type: 'open-lobby' },
            variant: 'primary',
        },
        {
            label: 'game.tactics.menu.loadGame',
            action: { type: 'navigate', target: '/saves' },
            variant: 'secondary',
        },
        {
            label: 'game.tactics.menu.settings',
            action: { type: 'navigate', target: '/settings' },
            variant: 'secondary',
        },
        {
            label: 'game.tactics.menu.replays',
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
            label: 'game.tactics.menu.quit',
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
