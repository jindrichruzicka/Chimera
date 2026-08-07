# Scaffold Templates — Rules

Applies to every file under `tools/create-chimera-game/templates/`. These files are
not engine source: the initializer copies `templates/<id>/` verbatim into an adopter's
own project, so a reader of a template comment has this repo's code but none of its
docs, issues, or numbering.

This file lives one level above `templates/` on purpose — `templates` is in the
package's published `files`, so anything inside it ships in the npm tarball.

Source of truth:

- [§16 Code Comments](../../docs/coding-standards-sections/code-comments.md) — §16.5 is the template-only rule.

Fast BLOCK checklist:

- No `Invariant #nn` references. State the rule in the sentence, or name the lint rule that enforces it — an adopter has no `architecture-invariants.md`, and may number their own invariants differently.
- No `§n.n` or `<doc>.md` doc-section references. The adopter cannot open the doc, so the constraint has to be stated in full where it applies.
- No engine milestone, feature, issue, PR, or AC references (`M9`, `F67`, `#813`) — already banned repo-wide by §16.4, and doubly meaningless here.
- Do not redirect a dropped reference at a different guard without checking that guard's scope first. A wrong pointer is worse than none; delete instead.
- Rules the template relies on stay stated — dropping a reference must not drop the constraint it carried.
- Comments may name things the adopter's project actually contains: its own scripts (`pnpm verify:packaged-bundle`), its lint rules (`chimera/no-game-renderer-internals`), its files, and installed `@chimera-engine/*` package paths.
- Ship only what an adopter needs. Engine-shell behaviour the blank game does not own (the boot logo, the shell's console banner) belongs in this repo's own suites, not in a scaffolded game's tests.
