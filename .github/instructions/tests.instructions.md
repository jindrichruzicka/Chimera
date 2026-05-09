---
applyTo: '**/*.test.ts,**/*.test.tsx'
---

# Test Files — Rules

Source of truth:

- [TDD skill](../skills/tdd/SKILL.md)
- [Testing standards](../../docs/coding-standards-sections/testing.md)
- [Property and soak tests](../../docs/testing/property-tests-soak.md)
- [Playwright E2E](../../docs/testing/e2e-testing-playwright.md)

Use this file only as the fast BLOCK checklist:

- Red first: add or update the failing test, run it, and confirm a meaningful failure before implementation.
- Unit tests stay co-located; integration tests use `<package>/__tests__/`; doubles live in `<package>/__test-support__/` only.
- Unit tests avoid real FS, network, WebSocket, and Electron IPC; use in-memory repositories/providers or direct in-process calls.
- Browser APIs require `// @vitest-environment jsdom` as the first line.
- React tests use React Testing Library and cover loading, resolved, and interaction/dispatch paths relevant to the component.
- Simulation tests call reducers/pipelines directly and assert no input mutation; do not mock internal simulation modules.
- Cover every public method, documented error, and meaningful `validate()`/`reduce()` branch touched by the change.
