/**
 * simulation/foundation/scene-lifecycle.ts
 *
 * Which scene actions FINISH a transition, as opposed to starting one.
 *
 * A foundation leaf rather than a member of `engine-contract.ts`, which is pure
 * type declarations and stays that way, and rather than a private helper in the
 * pipeline: two sides of the same rule consult this — the pipeline's
 * terminal-match gate and the game route's `sendAction` wrapper — and the
 * renderer may not import `simulation/engine`. Two copies of the list would
 * drift silently, and the shape of the drift is one guard admitting an action
 * the other drops, which is invisible until a transition hangs.
 *
 * Architecture references: §4.7 action pipeline, §4.18–§4.19 scene transitions.
 */

/**
 * Whether `actionType` completes a scene transition already under way.
 *
 * The terminal-match gate lets these through after a `gameResult` is recorded.
 * A transition can be in flight when a match resolves — nothing ties
 * `gameResult` to `sceneTransition`, and the resolver runs on the output of
 * every reduce, including the prepare's own — and refusing them there strands
 * the transition: the acks are what the host waits for, the host's own commit
 * or drop is what clears it, and the barrier's tick-denominated timeout cannot
 * elapse because `engine:tick` stays refused.
 *
 * Admitting them is necessary and not sufficient: the release still needs every
 * seat to acknowledge, or the host's own budget to expire the transition. What
 * the acks alone do is measured in
 * `simulation/scene/__tests__/terminal-match-transition.test.ts`, and what
 * happens when a seat cannot acknowledge at all in
 * `simulation/scene/__tests__/unackable-seat-barrier.test.ts`.
 *
 * `engine:scene_prepare` is deliberately absent: a resolved match may FINISH the
 * transition it is in, and may not BEGIN another.
 */
export function isSceneTransitionCompletionAction(actionType: string): boolean {
    return (
        actionType === 'engine:scene_ready' ||
        actionType === 'engine:scene_commit' ||
        actionType === 'engine:scene_drop' ||
        // The host declaring its own budget elapsed. It only unblocks the
        // commit or drop beside it, so refusing it after a result would strand
        // the very transitions those two were admitted to finish.
        actionType === 'engine:scene_expire'
    );
}
