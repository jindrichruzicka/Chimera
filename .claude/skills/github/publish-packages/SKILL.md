---
name: publish-packages
description: 'Publish the @chimera-engine/* engine packages + create-chimera-game to npm with Changesets-driven independent per-package semver. Default mode preps the release locally (changeset version, tag) and pushes tags so the release.yml CI workflow builds, runs verify:pack/verify:publish, and publishes with npm provenance. The --local flag runs the full publish from this machine (no provenance) as a break-glass fallback when GitHub Actions is unavailable. Use when: shipping new package versions to the npm registry. Separate from create-release (which cuts the milestone GitHub release).'
argument-hint: '[--local]'
user-invocable: true
---

# Publish Packages Skill

Ships `@chimera-engine/{simulation,ai,networking,renderer,electron}` and `create-chimera-game` to npm with **independent, Changesets-driven per-package semver**. This is **not** `/create-release` — that cuts the milestone/project GitHub release; this publishes packages to the registry.

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

## Step 1 — Declare the bumps (changesets)

Skip if `.changeset/*.md` (other than `README.md`/`config.json`) already describe this release.

```bash
pnpm changeset            # interactive: pick packages + bump level + summary
```

Non-interactive (agent) path — author `.changeset/<slug>.md` directly:

```markdown
---
'@chimera-engine/simulation': minor
'@chimera-engine/renderer': patch
---

Summary line that becomes the CHANGELOG entry.
```

A **breaking** `@chimera-engine/simulation` change is a **major** bump; the `verify:changeset-policy` gate (Step 2) enforces the downstream cascade.

> First-publish exception: with no changesets, current manifest versions publish as-is (how `0.9.0` first shipped). After that, every release needs a changeset to move versions.

## Step 2 — Versioning-policy gate

```bash
pnpm verify:changeset-policy
```

## Step 3 — Apply versions

```bash
pnpm version-packages     # = changeset version && pnpm install --lockfile-only
```

Consumes the changesets: bumps each `package.json`, writes per-package `CHANGELOG.md`, updates the lockfile. Review the diff.

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

- **Never** attempt to republish an existing version — bump via a changeset instead.
- Package versions are **independent** of the milestone/project version; this is not `/create-release`.
- **Heads-up:** `release.yml` also triggers on milestone `v*.*.*` tags, so `/create-release` publishes any pending package versions too — keep that in mind when cutting a milestone.
- `--local` publishes carry **no provenance** (OIDC is CI-only); prefer default mode.
