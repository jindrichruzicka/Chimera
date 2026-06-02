---
description: 'Cut a versioned release from a completed GitHub milestone. Usage - /create-release <milestone-designator> (e.g. M1, M2, "M1 — Core Engine")'
argument-hint: '<milestone-designator>'
---

Given milestone `$1`:

Load [create-release skill](../skills/github/create-release/SKILL.md) and follow it exactly. The skill owns milestone readiness, version proposal, README/CHANGELOG/package updates, gate commands, commit/tag/push/release, and milestone closure.

Stop for the version confirmation required by the skill. Report tag, commit SHA, release URL, milestone state, files updated, and gates run.
