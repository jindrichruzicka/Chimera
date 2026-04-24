> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Extend `ActionPipeline` in `simulation/engine/ActionPipeline.ts` with an optional
`debugObserver` callback on `PipelineContext`. The callback is called between step 5
(reduce) and step 7 (broadcast) of the pipeline with the new tick number and the
resulting `GameSnapshot`. The callback must only be present when `IS_DEBUG_MODE` is
true at runtime — in production bundles, the entire call site is dead-code-eliminated.
No changes to the pipeline's public API; `debugObserver` is an optional field that
defaults to `undefined`.

## Implementation notes

- File to modify: `simulation/engine/ActionPipeline.ts`
- Add to `PipelineContext`: `debugObserver?: (tick: number, snapshot: GameSnapshot) => void`
- Call site: `context.debugObserver?.(nextState.tick, nextState);` between step 5 and step 7
- Must NOT break existing pipeline behaviour when `debugObserver` is absent
- Add a comment: `// Set only when IS_DEBUG_MODE is true. Never present in production bundles.`

## Acceptance Criteria

- [ ] `PipelineContext.debugObserver` is optional and defaults to `undefined`
- [ ] Callback fires after step 5 (reduce) and before step 7 (broadcast) with correct `(tick, snapshot)` values
- [ ] Existing pipeline unit tests pass unchanged
- [ ] New unit test: `debugObserver` fires once per `pipeline.process()` call when set
- [ ] New unit test: pipeline behaves identically when `debugObserver` is absent
- [ ] No forbidden cross-module imports (verified by lint)

## Invariants touched

- Invariant 43: The `debugObserver` callback must not alter `GameSnapshot` or tick values — read-only observation only
