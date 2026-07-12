---
name: publish-packages
description: 'Publish the @chimera-engine/* engine packages + create-chimera-game to npm with Changesets-driven independent per-package semver. Default mode preps the release locally (changeset version, tag) and pushes tags so the release.yml CI workflow builds, runs verify:pack/verify:publish, and publishes with npm provenance. The --local flag runs the full publish from this machine (no provenance) as a break-glass fallback when GitHub Actions is unavailable. Use when: shipping new package versions to the npm registry. Separate from create-release (which cuts the milestone GitHub release).'
argument-hint: '[--local]'
user-invocable: true
---

# Publish Packages Skill

Ships `@chimera-engine/{simulation,ai,networking,renderer,electron}` and `create-chimera-game` to npm under the **locked `1.X.Y` versioning scheme** — every one of these packages shares **one version**, kept in sync via a Changesets `fixed` group. This is **not** `/create-release` — that cuts the milestone/project GitHub release; this publishes packages to the registry.

> **Locked `1.X.Y` (from `1.0.0`).** See [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md). Between milestones, a package update bumps the shared **patch** → `1.X.(Y+1)`, and **all** first-party packages republish together at that version (even ones with no source change) so the shared version always signals a compatible set. A new compatibility line (`X`) is a milestone, cut via `/create-release`.

Two modes:

| Mode                        | How packages publish                                                                          | Provenance    | Use when                         |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------- | -------------------------------- |
| **default** (CI-triggered)  | push tags → `release.yml` runs build → `verify:pack` → `verify:publish` → `changeset publish` | ✅ yes (OIDC) | normal releases                  |
| **`--local`** (break-glass) | `changeset publish` from this machine                                                         | ❌ no         | Actions down / registry-only fix |

## Preconditions (both modes)

- On `main`, working tree clean apart from intentional `.changeset/*.md`.
- Every version you intend to ship is **not already on the registry** — npm forbids republishing a version. New work ⇒ a changeset (Step 1).
- **default mode:** the `NPM_TOKEN` repo secret is set (one-time; an npm **granular** access token with All-packages **read/write** + the `chimera-engine` org read/write) and `gh` is authenticated (to watch the run).
- **`--local` mode:** `~/.npmrc` holds that same granular token at `//registry.npmjs.org/:_authToken=`. Classic "Publish"/login tokens fail with `E403 … 2fa … required` under npm policy. After `npm config set`, confirm `~/.npmrc`'s mtime actually changed before relying on it (`npm whoami` succeeds on a stale token and hides a no-op write).

## Step 1 — Declare the bump (one changeset)

Skip if `.changeset/*.md` (other than `README.md`/`config.json`) already describe this release.

Because the first-party packages are a Changesets **`fixed` group**, a single changeset bumps the **whole set** to one version — you do not (and should not) list each package. Pick the bump level for the shared version:

- **`patch`** — a between-milestone package update → `1.X.Y` → `1.X.(Y+1)` (the normal case for this skill).
- **`minor`** — a new compatibility line `X` (`1.X.Y` → `1.(X+1).0`); usually cut via `/create-release` at a milestone, not here.

```bash
pnpm changeset            # interactive: pick ANY member of the fixed group + bump level + summary
```

Non-interactive (agent) path — author `.changeset/<slug>.md` directly. Naming one member is enough; the `fixed` group carries the rest:

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

Run `verify:version-alignment` after Step 3 (once versions are applied) — that is when the manifests reflect the new shared version.

## Step 3 — Apply versions

```bash
pnpm version-packages        # = changeset version && pnpm install --lockfile-only
pnpm verify:version-alignment # confirm the whole fixed group landed on ONE 1.X.Y
```

Consumes the changesets: the `fixed` group bumps **every** first-party `package.json` to the same version, writes per-package `CHANGELOG.md`, and updates the lockfile. `verify:version-alignment` must pass — if it reports drift, re-align before committing (never override). Review the diff.

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

```bash
pnpm exec changeset tag           # lightweight tags: @chimera-engine/<pkg>@<ver>
git push origin main --tags       # pushes the release commit + tags together
```

The push fires the pre-commit gate hook (gate runs again) and then `release.yml`, which triggers on `@chimera-engine/*` (and `v*.*.*`) tags.

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

> Scoped packages can 404 on the public read API for ~15 min after a successful publish while replicas catch up — lag, not failure. Authoritative "it published": a re-publish returns `403 cannot publish over previously published version`. Never bump versions to "fix" the 404.

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

Then verify as in Step 7 (mind the ~15 min scoped read lag).

## Rules

- **Locked `1.X.Y`.** All first-party packages (`@chimera-engine/*` + `create-chimera-game`) share one version and **republish together** on every patch, even the unchanged ones — the shared version is the compatibility signal. Enforced by the `fixed` group + `verify:version-alignment`. Policy: [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md).
- **Never** attempt to republish an existing version — bump via a changeset instead.
- From `1.0.0` on, the package version and the milestone/project version are the **same shared `1.X.Y`** (a milestone sets `1.X.0` via `/create-release`; this skill ships patches `1.X.Y` between milestones).
- **Heads-up:** `release.yml` also triggers on milestone `v*.*.*` tags, so `/create-release` publishes any pending package versions too — keep that in mind when cutting a milestone.
- `--local` publishes carry **no provenance** (OIDC is CI-only); prefer default mode.
