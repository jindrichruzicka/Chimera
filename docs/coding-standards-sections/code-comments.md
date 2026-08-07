---
title: 'Chimera Coding Standards — §16 Code Comments'
description: 'How to write code comments in the Chimera engine: comment the why, not the what; keep them minimal; no issue or review-finding references; scaffold templates additionally drop invariant and doc-section references.'
tags: [comments, documentation, why-not-what, coding-standards]
---

# §16 Code Comments

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 16.1 Principle

Comment the **why**, never the **what**. Code already states what it does; a comment earns its place only by adding what the code cannot: intent, a constraint, a reason.

Most lines need no comment. A clean function with clear names is the goal — a comment is the exception, not the default.

## 16.2 When to comment

Add a comment only for something a competent reader cannot infer from the code alone:

- **Why**, not what — the reason a choice was made, not a restatement of the mechanics.
- **Workarounds** — why the obvious approach was avoided (platform bug, upstream limitation, race, ordering constraint). Name the cause.
- **Edge cases** — a non-obvious input or state the code guards against.
- **Business / domain rules** — a value or branch that exists because the domain demands it, not the code.
- **"Don't touch this"** — load-bearing logic that looks removable but isn't; say why removing it breaks things.

## 16.3 When NOT to comment

- **Never restate the code.** `i++ // increment counter` is banned. If the comment tracks the code line-for-line, delete it.
- **Skip self-explanatory lines.** Well-named code is its own documentation.
- **No commented-out code.** Delete it; git remembers.
- **No changelog / attribution narration** in comments (who changed it, when, "used to be X"). That is git's job.

## 16.4 Forbidden references

Comments describe the code as it stands now, for a reader who has only the code — not the history that produced it. These never belong in a comment:

| Forbidden                         | Examples                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Issue / ticket references         | `// see #853`, `// per M9`, `// TODO(#123)`                                                                  |
| Code-review finding references    | `// WARN-1`, `// BLOCK-1`, `// addresses BLOCK-2`, `// review fix`                                           |
| PR / commit references            | `// from PR 42`, `// reverted in abc1234`                                                                    |
| Numbered acceptance-criteria refs | `// (AC #2)`, `// acceptance criterion #3` — the number points into an issue's AC list the code cannot reach |

If a finding or issue drove a non-obvious decision, keep the **reason** and drop the reference: `// clamp before render — sub-pixel offset tore the boot logo` (not `// fixes BLOCK-1`).

For acceptance criteria, carry the criterion **text** instead of its number: `(AC: "importing the barrel is side-effect-free")` stays true without the issue. Unnumbered quoted forms and structural per-test labels (an `AC1:` describe prefix that other tests name) are fine; the numbered `AC #N` pointer is not. Enforced by `tools/stale-ac-references.test.ts`.

The `@chimera-review:` and `@ts-expect-error:` tags required by [§1 TypeScript](typescript.md) are the sole sanctioned exception — they state a reason and carry no issue/finding id. Neither is grepped by CI: `@ts-expect-error` needs its description because `@typescript-eslint/ban-ts-comment` demands one, and `@chimera-review:` is checked only where `chimera/no-fromfloat-in-simulation` requires it as a companion to a disable of that rule.

## 16.5 Scaffold templates: also drop invariant and doc-section refs

Applies **only** to files under `tools/create-chimera-game/templates/`. Everywhere else in the engine, `Invariant #nn` and `§n.n` doc-section references are encouraged — they point a reader at something the repo actually contains.

A template file does not ship into this repo. It is copied verbatim into an adopter's own project, which has no `architecture-invariants.md`, no `docs/`, and its own numbering if it keeps invariants at all. There, `Invariant #96` is either unresolvable or resolves to a rule that is not the one meant. So in template files these are forbidden too:

| Forbidden in templates | Instead                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `Invariant #nn`        | State the rule in the sentence, or name the lint rule that enforces it    |
| `§n.n`, `<doc>.md`     | State the constraint in full — the adopter has no copy of the doc to open |
| Engine milestones      | Drop; `M9 / F67` names nothing an adopter can look up (already §16.4)     |

The number is never the point — the rule is. `// Invariant #87: every screen registered here must be wrapped in React.lazy` becomes `// Every screen registered here must be wrapped in React.lazy` and loses nothing.

Do not redirect a dropped reference at a different guard unless you have checked that guard's scope. Swapping a dangling reference for a wrong one is worse than deleting it.

## 16.6 Style

- One idea per comment; prefer a single line. Reserve block/JSDoc comments for public API surface and genuinely intricate algorithms.
- Write for the next engineer, plainly. No hedging, no filler, no restating the ticket.
- Keep the comment next to what it explains, and update it when that code changes — a stale comment is worse than none.

## 16.7 Examples

```ts
// BAD — restates the code
// loop over players and reset their score
for (const p of players) p.score = 0;

// GOOD — no comment needed; the code is clear
for (const player of players) player.score = 0;
```

```ts
// BAD — references a review finding
const offset = clampToPixel(raw); // BLOCK-1 fix

// GOOD — keeps the reason, drops the reference
// Snap to whole pixels: sub-pixel offsets tore the boot-logo video on macOS.
const offset = clampToPixel(raw);
```

```ts
// GOOD — a business rule the code alone can't justify
// House rule: a tie on the final tick goes to the defender, never the attacker.
return attackerScore > defenderScore ? attacker : defender;
```
