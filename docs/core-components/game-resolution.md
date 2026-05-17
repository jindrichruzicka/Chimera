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

Undo/redo reconstruction replays committed actions and reruns the resolver for the reconstructed snapshot. This means a result can disappear when undo moves the history before the resolving action, then reappear when redo or a new resolving action reaches an ended state again.

Because the resolver is pure and idempotent, replaying the same history yields the same `gameResult`. Any future action after undo invalidates redo history according to the action history contract in §4.36.

## Save Compatibility

Saves written before game resolution did not contain `checkpoint.gameResult`. The v3 to v4 save migration adds `gameResult: null` without overwriting existing non-null results, preserving old saves as in-progress matches.
