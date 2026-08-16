---
name: publish-packages
description: 'Publish @chimera-engine/* + create-chimera-game to npm (Changesets, locked shared 1.X.Y). Default preps locally and pushes tags so release.yml publishes with provenance; --local is the break-glass full local publish. Use when: shipping package versions to npm (create-release cuts the milestone GitHub release).'
argument-hint: '[--local]'
user-invocable: true
---

# Publish Packages Skill

Ships `@chimera-engine/{simulation,ai,networking,renderer,electron}` and `create-chimera-game` to npm under the **locked `1.X.Y`** scheme — one shared version, kept in sync via a Changesets `fixed` group.

> **Locked `1.X.Y` (from `1.0.0`)** — [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md). Between milestones a package update bumps the shared **patch** → `1.X.(Y+1)`, and **all** first-party packages republish together at that version (even unchanged ones) so the shared version always signals a compatible set. A new compatibility line (`X`) is a milestone, cut via `/create-release`.

Two modes:

| Mode                        | How packages publish                                                                          | Provenance    | Use when                         |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------------- |
| **default** (CI-triggered)  | push tags → `release.yml` runs build → `verify:pack` → `verify:publish` → `changeset publish` | ✅ yes (OIDC) | normal releases                  |
| **`--local`** (break-glass) | `changeset publish` from this machine                                                         | ❌ no         | Actions down / registry-only fix |

## Preconditions (both modes)

- On `main`, working tree clean apart from intentional `.changeset/*.md`.
- No version you intend to ship is already on the registry — npm forbids republishing. New work ⇒ a changeset (Step 1).
- **default:** `NPM_TOKEN` repo secret set (one-time; an npm **granular** access token with All-packages **read/write** + the `chimera-engine` org read/write) and `gh` authenticated (to watch the run).
- **`--local`:** `~/.npmrc` holds that same granular token at `//registry.npmjs.org/:_authToken=`. Classic "Publish"/login tokens fail with `E403 … 2fa … required` under npm policy. After `npm config set`, confirm `~/.npmrc`'s mtime actually changed — `npm whoami` succeeds on a stale token and hides a no-op write.

## Step 1 — Declare the bump (one changeset)

Skip if `.changeset/*.md` (other than `README.md`/`config.json`) already describe this release.

The first-party packages are a Changesets **`fixed` group** — a single changeset bumps the whole set to one version; do not list each package. Bump level for the shared version:

- **`patch`** — between-milestone package update, `1.X.Y` → `1.X.(Y+1)` (the normal case for this skill).
- **`minor`** — new compatibility line, `1.X.Y` → `1.(X+1).0`; usually cut via `/create-release` at a milestone, not here.

```bash
pnpm changeset            # interactive: pick ANY member of the fixed group + bump level + summary
```

Non-interactive (agent) path — author `.changeset/<slug>.md` directly; naming one member is enough, the `fixed` group carries the rest:

```markdown
---
'@chimera-engine/renderer': patch
---

Summary line that becomes the CHANGELOG entry (describe what actually changed).
```

> First-publish exception: with no changesets, current manifest versions publish as-is (how `0.9.0` first shipped, pre-lock-step). After `1.0.0`, every release needs a changeset to move the shared version.

## Step 2 — Versioning-policy gate

```bash
pnpm verify:version-alignment   # all first-party pkgs on the SAME 1.X.Y (post-version-apply, Step 3)
pnpm verify:changeset-policy    # legacy cascade gate; a no-op under the fixed group, kept for safety
```

Run `verify:version-alignment` after Step 3, once the manifests reflect the new shared version.

## Step 3 — Apply versions

```bash
pnpm version-packages        # = changeset version && pnpm install --lockfile-only
pnpm verify:version-alignment # confirm the whole fixed group landed on ONE 1.X.Y
```

Consumes the changesets: bumps **every** first-party `package.json` to the same version, writes per-package `CHANGELOG.md`, updates the lockfile. If `verify:version-alignment` reports drift, re-align before committing — never override. Review the diff.

Then regenerate the scaffold's toolchain snapshot, which pins `ENGINE_DEP_RANGES` at the engine versions you just wrote, and re-run `format:check` on the generated CHANGELOGs:

```bash
pnpm gen:toolchain            # ENGINE_DEP_RANGES ^<old> -> ^<new>
pnpm verify:toolchain-snapshot
pnpm format:check
```

> **If `format:check` fails on a generated `CHANGELOG.md`, do not run `prettier --write` on it.** A changeset body that wraps an **inline code span across a line break** with the continuation at column 0 is legal at top level — the source changeset passes Prettier — but `changeset version` indents the body four spaces under a CHANGELOG list item, and the column-0 line becomes a lazy continuation that reparses. Prettier is then non-idempotent on the result: `--write` output still fails `--check`, and each pass eats the spaces around backticks, corrupting the release notes. Fix the **source changeset** instead — `git checkout -- .` to undo the bump, rewrap so no code span spans a line break, then redo this step. Find candidates by scanning each changeset for lines with an odd backtick count outside fenced blocks. (Measured on `1.0.0-rc.6`: two of 62 changesets did this.)

## Step 4 — Commit the release (on `main`)

```bash
git add -A
git commit -m "chore(release): publish <summary of versions>" \
           -m "- Versions applied by Changesets; per-package CHANGELOGs written." \
           -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

The pre-commit gate hook runs `format:check && lint && typecheck && test` automatically.

---

### Default mode (CI-triggered) — Steps 5–7

## Step 5 — Tag and push (triggers `release.yml`)

Push in **three** steps, never `git push origin main --tags`. GitHub creates no workflow events for a push carrying more than three tags, and the fixed group is six — so a combined push lands every tag on the remote while firing nothing, and `release.yml` never runs.

```bash
pnpm exec changeset tag                                        # lightweight tags: @chimera-engine/<pkg>@<ver>
git push origin main                                           # 1. the release commit, alone
git push origin "refs/tags/@chimera-engine/simulation@$VER"    # 2. ONE tag alone — fires release.yml
git push origin --tags                                         # 3. the remaining five; >3, so no duplicate run
```

Each push fires the pre-commit gate hook again. `release.yml` triggers on `@chimera-engine/*` (and `v*.*.*`) tags, and one tag is enough — the publish job builds from the commit, not from the tag it was reached by. Confirm exactly one run started before pushing the rest:

```bash
gh run list --workflow=release.yml --limit 1   # expect in_progress on the release commit
```

> Every release through `1.0.0-rc.5` used the combined push and lost the trigger, recovering by deleting the tag locally and on the remote and re-pushing it alone. `1.0.0-rc.6` used the order above and fired first try. Step 3 pushes five tags, which is also over the threshold, so it adds no second run. If a future group ever shrinks to three or fewer members, a combined push would fire one event per tag — several concurrent publish runs — so keep the lone-tag order regardless of group size.

## Step 6 — Watch the run

```bash
gh run list --workflow=release.yml --limit 1
gh run watch <run-id> --exit-status     # non-zero if the publish job fails
```

CI does: build → `verify:pack` (e2e against packed tarballs) → `verify:publish` → `changeset publish` with `NPM_TOKEN` + `NPM_CONFIG_PROVENANCE=true`.

## Step 7 — Verify on the registry

```bash
for p in simulation ai networking renderer electron; do
  curl -s -o /dev/null -w "@chimera-engine/$p → %{http_code}\n" \
    "https://registry.npmjs.org/@chimera-engine%2f$p"
done
```

> Scoped packages can 404 on the public read API for ~15 min after a successful publish — replica lag, not failure. Authoritative "it published": a re-publish returns `403 cannot publish over previously published version`. Never bump versions to "fix" the 404.

---

### `--local` mode (break-glass) — Steps 5L–7L

Run only when CI cannot (Actions down). **No provenance.**

## Step 5L — Build + true-artifact gates

```bash
pnpm build:packages
pnpm --filter create-chimera-game build   # esbuild bin; not part of tsc -b
pnpm verify:pack
pnpm verify:publish
```

## Step 6L — Publish from this machine

```bash
pnpm release              # = build:packages && changeset publish
```

Uses the granular token in `~/.npmrc`. `changeset publish` publishes only versions not yet on the registry and creates local tags.

## Step 7L — Push tags + verify

```bash
git push origin main --tags
```

The combined push is correct **here** — the packages are already on the registry, so the >3-tag rule from Step 5 works in your favour: no `release.yml` run starts, and none is wanted. (A run would be a no-op anyway; `changeset publish` skips published versions.) Do not copy this line into Step 5.

Then verify as in Step 7 (mind the ~15 min scoped read lag).

## Rules

- **Locked `1.X.Y`:** the whole set (`@chimera-engine/*` + `create-chimera-game`) **republishes together** on every patch, even unchanged members — the shared version is the compatibility signal. Enforced by the `fixed` group + `verify:version-alignment`. Policy: [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md).
- **Never** republish an existing version — bump via a changeset instead.
- From `1.0.0` on, package version = milestone/project version (a milestone sets `1.X.0` via `/create-release`; this skill ships patches `1.X.Y` between milestones).
- `release.yml` also triggers on milestone `v*.*.*` tags, so `/create-release` publishes any pending package versions too — mind that when cutting a milestone. That path pushes a single tag alone and is unaffected by the >3-tag rule.
- **Never `git push origin main --tags` in default mode** — more than three tags in one push fires no workflow event, so the release lands untriggered. Push the commit, then one tag, then the rest (Step 5).
- `--local` publishes carry **no provenance** (OIDC is CI-only); prefer default mode.
