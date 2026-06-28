# create-chimera-game

## 0.1.0

### Minor Changes

- Initial release: scaffold a new Chimera game. By default emits a SELF-CONTAINED project — its
  own toolchain `package.json`, `pnpm-workspace.yaml`, `vitest.config.mts`, and a `tsconfig.json`
  carrying the frozen root `compilerOptions`, with the app's `@chimera-engine/*` deps on their published
  `^x.y.z` ranges — that installs and boots with **no monorepo clone**. `--workspace` instead adds
  an in-monorepo app (what `pnpm create:game` runs). The published package bundles the blank
  template and a frozen toolchain snapshot, so `npm create chimera-game` works standalone; the
  `verify:scaffold` gate boots the emitted project from packed tarballs end-to-end.
