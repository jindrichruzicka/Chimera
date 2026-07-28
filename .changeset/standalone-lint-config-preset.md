---
'@chimera-engine/electron': minor
---

Add `standaloneLintConfig()` to `@chimera-engine/electron/eslint` — the games-facing
half of the architecture-lint surface. The subpath already exposed the seven rules as a
plugin object; a game still had to know which of them apply to game code, at what
severity, and on which of its own directories. The factory answers that:

```js
const base = [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked];

export default [
    { ignores: ['dist/**', '.next/**'] },
    ...base,
    ...standaloneLintConfig({ css, silenceOnCss: base }),
    prettier,
];
```

It is an **overlay, not a base**. What comes back is the curated rule blocks and nothing
else — no recommended sets, no parser options, no global `ignores`. Four rules travel:
`no-fromfloat-in-simulation` on `simulation/**` and `ai/**`, `no-hardcoded-design-values`
on `screens/**` and its CSS modules, `no-unknown-token-overrides` on
`styles/tokens-override.css`, and `no-game-renderer-internals` across the app. The three
engine-internal boundary rules do not, and the reasons are recorded per rule.

`silenceOnCss` matters, and passing the base twice is not redundancy. Two of the curated
rules fire on CSS, which needs the `@eslint/css` language — and a flat config resolves
rules from every matching block, so a base with no `files` restriction has its JS rules
applied to the stylesheet too. That is not a false positive: `no-irregular-whitespace` dies
with `sourceCode.getAllComments is not a function`, and any type-checked `typescript-eslint`
set dies demanding type information for a `.css` file. Nor does it degrade — ESLint aborts
the whole run, so one unhandled stylesheet means the game lints nothing at all.

`js.configs.recommended` is silenced for free, since it is in effectively every flat
config. Anything else unscoped — above all a type-checked `typescript-eslint` set — has to
be named, because only the game knows what it applies and a list baked into the preset
would cover the sets that existed when it was written and no others. Missing one is loud:
an abort naming the rule and the `.css` file.

Pass the whole base. A game that lints its own stylesheets keeps its `css/*` rules on the
files this preset also governs: a rule is left alone when its namespace names a plugin
that brings its own language, and registrations are read across every config handed in
**and across the preset's own blocks**. That covers the `@eslint/css` README shape, a
separate setup block, a per-directory override, a scoped or simple alias, and rules named
against the registration this preset already supplies — each with a test. A base already
scoped to JS/TS files needs none of this.

Two facts worth knowing before trusting a green run. The CSS arm **widens** what
`eslint .` covers — it pulls `.css` files into a run that previously skipped them, which is
how the token rules reach them at all. And three of the four rules require an
`apps/<name>/` segment in the absolute path, because their own predicates read it: a game
at `<project>/apps/<kebab>` gets all four, and the same game at a bare project root loses
`no-game-renderer-internals` and `no-unknown-token-overrides` silently.

`@eslint/css` and `@eslint/js` are declared as **optional** peer dependencies and required
on demand, never at module scope: a module-top import would break `chimeraPlugin` too, for every consumer
who never asked for the preset. It can also be injected through the `css` option, which is
the reliable route under a package manager that does not install optional peers beside
this package. The two are not symmetric: an unresolvable `@eslint/css` throws with
instructions, because the CSS blocks cannot be built without it, while an unresolvable
`@eslint/js` simply contributes no baseline — leaving `silenceOnCss` to cover what it would
have.
