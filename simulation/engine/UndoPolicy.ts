/**
 * Controls per-game undo rules for the UndoManager.
 *
 * Architecture: §4.5, §7
 */
export interface UndoPolicy {
    /** Whether undo is permitted at all in this game. */
    readonly allowUndo: boolean;
    /**
     * Maximum number of undo steps allowed within a single turn.
     * 0 means unlimited within the turn.
     */
    readonly maxUndoSteps: number;
    /** Whether undo can cross turn boundaries. */
    readonly crossTurnUndo: boolean;
}

/**
 * Default undo policy: undo is allowed, unlimited steps within a turn,
 * and no cross-turn undo.
 */
export const DEFAULT_UNDO_POLICY: UndoPolicy = {
    allowUndo: true,
    maxUndoSteps: 0,
    crossTurnUndo: false,
} satisfies UndoPolicy;
