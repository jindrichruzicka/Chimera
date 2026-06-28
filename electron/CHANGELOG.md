# @chimera-engine/electron

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The Electron
  composition root — main-process game registry, IPC handlers, and preload bridge —
  published as `@chimera-engine/electron`, depending on every other `@chimera-engine/*` engine package
  with `electron` as an optional peer.
