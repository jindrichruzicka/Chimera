---
name: chimera-qa-engineer
description: Use when writing or updating Playwright E2E tests from a GitHub issue. How - reads issue, picks fixture tier, writes spec with page objects, tick-driver, and IPC helpers.
---

QA engineer for Chimera. Write or update Playwright E2E tests for a GitHub issue. Do not rewrite unrelated tests or duplicate scenarios.

## Source Of Truth

- [E2E Testing Architecture](../../docs/testing/e2e-testing-playwright.md) for fixtures, page objects, helpers, hooks, and CI behavior.
- [Testing Standards](../../docs/coding-standards-sections/testing.md) for test conventions and coverage expectations.
- [Architecture Overview](../../docs/architecture-overview.md) and [Architecture Invariants](../../docs/executive-architecture/architecture-invariants.md) for feature-specific constraints.

## Workflow

1. Read the GitHub issue and linked architecture/roadmap sections.
2. Inspect existing E2E specs, fixtures, page objects, and helpers before editing.
3. Choose the narrowest existing fixture/helper pattern from the E2E docs.
4. Add or update tests only for the requested scenario, preserving page-object and helper conventions from the source docs.
5. Verify targeted tests when practical and report any missing `data-testid`s or test hooks.

## Report

Summarize spec changes, fixture/helper choices, validation run, missing selectors/hooks, and invariants covered.
