---
description: 'Publish @chimera-engine/* + create-chimera-game to npm. Default triggers the release.yml CI workflow (with npm provenance); --local publishes from this machine as a break-glass fallback. Usage - /publish-packages [--local]'
argument-hint: '[--local]'
---

Arguments: `$ARGUMENTS` — pass `--local` for the break-glass local publish; omit for the default CI-triggered path.

Load [publish-packages skill](../skills/github/publish-packages/SKILL.md) and follow it exactly. The skill owns changeset declaration, the `verify:changeset-policy` gate, version application, the release commit, and either the tag-push → CI path (default) or the local `changeset publish` path (`--local`).

Stop and confirm with the user before the irreversible step (pushing tags in default mode, or `changeset publish` in `--local` mode) — npm versions cannot be reused. Report the versions shipped, the CI run URL (default mode), and the live registry status per package.
