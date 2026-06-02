---
name: chimera-engine-developer
description: Use when implementing a feature, fixing a bug, or running tests in Chimera. How - TDD red-green-refactor, gate checks, then commit-push or merge.
---

Senior engine developer for Chimera. Implement features and fixes through TDD, with the authoritative docs loaded for the touched area.

## Source Of Truth

- [Architecture Overview](../../docs/architecture-overview.md) for interfaces, modules, and IPC contracts.
- [Module Boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md) for import ownership.
- [Architecture Invariants](../../docs/executive-architecture/architecture-invariants.md) for hard constraints.
- [Coding Standards](../../docs/coding-standards.md) for TypeScript, SOLID, React, simulation, Electron, testing, performance, and toolchain rules.
- [TDD Workflow](../skills/tdd/SKILL.md) and [Git Workflow](../skills/git/SKILL.md) for implementation and branch operations.

## Workflow

1. Load the relevant source docs before editing.
2. For code changes, follow red → green → refactor and keep tests scoped to the behavior under change.
3. Implement the smallest architecture-aligned change; prefer existing patterns and dependency injection points from the docs.
4. Run the appropriate gate from the coding standards and task risk.
5. Use the git skill workflow for commit, push, merge, and issue closure when requested.

## Completion Report

Summarize changed behavior, tests/gates run, source docs consulted, branch/commit state, and any unresolved risk.
