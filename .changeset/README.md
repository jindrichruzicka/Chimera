# Changesets — Chimera per-package versioning & bump policy

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets). It
drives **independent** semantic versioning and **per-package changelogs** for the
`@chimera-engine/*` hierarchy: each package carries its own `version` and `CHANGELOG.md`, and
`fixed`/`linked` are empty in [`config.json`](./config.json) so a bump to one package
never forces an unrelated package to bump.

## Declaring a change

Run `pnpm changeset`, pick the affected package(s) and a bump level (`patch` / `minor` /
`major`), and write a one-line summary. This drops a markdown file in this folder. At
release time `pnpm version-packages` consumes every pending changeset, bumps each affected
package, and writes its `CHANGELOG.md` entry. `pnpm release` then builds and publishes.

## Bump policy — the `@chimera-engine/simulation` cascade

`@chimera-engine/simulation` is the zero-dependency leaf every other package points inward to
(Architecture Appendix C.4, Invariant #1). Its purity is what makes a break to it genuinely
**major** — so the policy is:

> **A breaking change to `@chimera-engine/simulation` is a `major` bump, and every publishable
> package that depends on it — `@chimera-engine/ai`, `@chimera-engine/networking`, `@chimera-engine/renderer`,
> `@chimera-engine/electron` — must be bumped `major` in the same release.**

The same rule applies to any package whose break propagates: a `major` on `@chimera-engine/renderer`
or `@chimera-engine/electron` requires a `major` on each of _its_ publishable dependents. The private
`@chimera-engine/tactics` reference app publishes nothing, so it is exempt — Changesets auto-bumps it.

Left to its defaults Changesets would only `patch`-bump dependents (just enough to keep their
pinned `workspace:*` ranges valid), silently weakening the semver promise. The
**`verify:changeset-policy`** gate ([`tools/changeset-policy.ts`](../tools/changeset-policy.ts))
enforces the cascade: it reads the pending changesets and fails if a publishable package is
majored without its publishable dependents also being majored.

### Worked example — a breaking change to `@chimera-engine/simulation`

```bash
pnpm changeset   # select @chimera-engine/simulation → major, and ai / networking / renderer / electron → major
pnpm verify:changeset-policy   # passes only when the full cascade is declared
pnpm version-packages          # simulation 0.9.0 → 1.0.0, and every dependent → its next major
```

If you forget a dependent, `verify:changeset-policy` reports exactly which package still needs a
`major` changeset.
