> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement the Inspector Window React application at `renderer/app/debug/page.tsx`. The
page guards itself at mount: if `window.__chimeraDebug` is absent (i.e. production
build or game renderer window), the page renders nothing and returns immediately. When
the debug surface is present, it renders six panels as described in §4.12:

| Panel | What it shows |
|---|---|
| **Timeline** | Scrollable tick list; ring-buffered ticks highlighted; live mode auto-scrolls |
| **Snapshot Inspector** | JSON tree of the full `GameSnapshot` at selected tick |
| **Projection Explorer** | `PlayerId` dropdown + side-by-side full vs. projected view |
| **Diff View** | Compare any two ticks; flat list of changed paths |
| **Action Log** | Filterable `ActionHistoryEntry` table; click to jump timeline |
| **Performance** | Tick duration graph, avg/max, ring buffer fill, total action count |

## Implementation notes

- File to create: `renderer/app/debug/page.tsx`
- Must check `window.__chimeraDebug` at mount; render nothing if absent
- Must NOT import from: `electron/main/`, `ai/engine/`, `games/*/data` (renderer boundary)
- Use narrow Zustand selectors or local React state — do not subscribe to the whole `gameStore`
- Live mode: call `window.__chimeraDebug.request({ type: 'SUBSCRIBE_LIVE' })` on mount; call `onLiveTick` to receive pushes
- Unsubscribe on unmount: `window.__chimeraDebug.request({ type: 'UNSUBSCRIBE_LIVE' })`
- Projection Explorer: fetch `{ type: 'GET_PROJECTION', tick, playerId }` per dropdown selection

## Acceptance Criteria

- [ ] Page renders nothing when `window.__chimeraDebug` is absent (production guard)
- [ ] Timeline panel displays tick list with ring-buffered ticks visually distinguished
- [ ] Live mode auto-scrolls Timeline as `LIVE_TICK` pushes arrive
- [ ] Snapshot Inspector renders full `GameSnapshot` JSON tree at selected tick
- [ ] Projection Explorer shows side-by-side full vs. projected view for each `PlayerId`
- [ ] Diff View renders flat diff list between any two selected ticks
- [ ] Action Log table filters by `playerId`, action type prefix, and tick range
- [ ] Performance panel shows avg/max tick duration, buffer fill, total action count
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist items "Timeline … Performance panels functional" and "Projection Explorer shows correct side-by-side view" are green

## Invariants touched

- Invariant 1: Projection Explorer calls `GET_PROJECTION` through the debug bridge — the `PlayerSnapshot` data shown is produced server-side and never exposes raw `GameSnapshot` to the renderer process
