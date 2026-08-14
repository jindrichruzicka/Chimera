# §4.38 Game Resolution & Winner Display

## Scope

Chimera represents completed matches with a single authoritative result value:

```ts
export interface GameResult {
    readonly winnerIds: readonly PlayerId[];
}
```

`winnerIds` contains every winning player. An empty `winnerIds` array represents a draw. A `null` match result means the match is still in progress.

## Authoritative Resolution

Game definitions may provide an optional pure resolver:

```ts
resolveGameResult?: (snapshot: Readonly<TState>) => GameResult | null;
```

`ActionPipeline` invokes the resolver after an action reducer produces the next snapshot. If the resolver returns a `GameResult`, the pipeline writes that result to `snapshot.gameResult` and moves the phase to `ended`. If the resolver returns `null`, the snapshot remains in progress.

Resolvers must be deterministic, idempotent, and free of host, renderer, network, or clock dependencies. They should inspect only the snapshot they receive and must not mutate it. See §4.2 for simulation purity and §4.6 for action pipeline ownership.

## Post-Result Action Lockout

Once `BaseGameSnapshot.gameResult` is non-null, the match is terminal. `ActionPipeline` rejects gameplay, turn, tick, undo, and redo actions before validation or undo reconstruction can run. Rejected actions use `ActionUnauthorizedError` with reason `match_already_resolved`.

`engine:sync_request` remains allowed after resolution so reconnecting clients can receive the final projected snapshot, and `engine:return_to_lobby` — the host-only abandon-to-lobby reset — because it does not mutate the recorded result.

The three scene actions that FINISH a transition are allowed too: `engine:scene_ready`, `engine:scene_commit` and `engine:scene_drop`. A transition can be in flight when a result lands — nothing ties `gameResult` to `sceneTransition`, and the resolver runs on the output of every reduce, including the prepare's own — and refusing them there strands it: the acks are what the host waits for, the host's own commit or drop is what clears the transition, and the barrier's timeout is counted in ticks that only an applied action advances. The set is the exported predicate `isSceneTransitionCompletionAction` in `simulation/foundation/scene-lifecycle.ts`, which both the pipeline gate and the renderer's `sendAction` wrapper consult, so the two cannot drift. `engine:scene_prepare` is deliberately excluded: a resolved match may finish the transition it is in, and may not begin another.

Admitting them is necessary and not sufficient — the release still needs every seat in `state.players` to acknowledge. What happens when one of them cannot is measured in `simulation/scene/__tests__/terminal-match-transition.test.ts`.

A commit that lands after a result carries the recorded `gameResult` through unchanged. `SceneDescriptor.initialize`/`teardown` may return any state and the commit spreads it, so without that the entered scene could blank a recorded result, the resolver would re-run on a null field, and gameplay would flow again into a finished match. Only `gameResult` is re-pinned — it is what the gate and the resolver key on — so a scene entered after a result still writes its own `phase`. A scene that RESOLVES a match on entry is unaffected either: the re-pin applies only when a result was already recorded.

Other match lifecycle changes, such as starting a new match or restoring a save, must happen through their owning session/runtime APIs rather than by continuing the resolved action stream.

## Projection And Boundaries

`BaseGameSnapshot.gameResult` is host-authoritative state. Projection carries the value through the existing safe snapshot path:

1. `BaseGameSnapshot.gameResult`
2. `DefaultStateProjector.project(...)`
3. `PlayerSnapshot.gameResult`
4. shared message schemas and provider/preload boundary types
5. renderer state and `GameShell`

The renderer must consume the projected `PlayerSnapshot` value. It must not import simulation engine modules or call game-specific result logic. This keeps IPC/network contracts explicit and follows the renderer boundary rules in §4.33.

## Winner Display

`GameShell` consumes the projected result from the current viewer's perspective. Presentation is
delegated to `GameScreenRegistry.gameResultBanner` when a game provides that optional slot. The
game component receives only `{ gameResult, localPlayerId }`, derives game-specific copy locally,
and remains renderer-only.

If no game banner is registered, `GameShell` displays the default engine fallback:

- `winnerIds` includes the local player: `You won`
- `winnerIds` is non-empty and does not include the local player: `You lose`
- `winnerIds` is empty: `Draw`

The result banner exposes `data-testid="game-result-banner"`, the text node exposes
`data-testid="game-result-text"`, and the banner root carries `data-game-result-outcome`, whether
rendered by the engine fallback or by a game component.

## Undo/Redo Semantics

Undo/redo remain normal `EngineAction` types while a match is in progress. After `gameResult` becomes non-null, both actions are rejected by the post-result lockout before the undo manager can reconstruct prior state. A resolved result is therefore stable for the lifetime of that session.

## Save Compatibility

Saves written before game resolution did not contain `checkpoint.gameResult`. The v3 to v4 save migration adds `gameResult: null` without overwriting existing non-null results, preserving old saves as in-progress matches.
