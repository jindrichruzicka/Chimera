# `chimera` ESLint rules + the standalone preset

The eight `chimera/*` rules are the executable half of the architecture invariants. Without
them, §3's module boundaries and §4.35's design-token discipline are prose that reviewers
have to remember.

They ship from `@chimera-engine/electron` at the **`@chimera-engine/electron/eslint`
subpath** — not a bin, unlike the four dev tools beside them, because a flat config imports
a plugin object and never spawns anything.

```js
import { chimeraPlugin, standaloneLintConfig } from '@chimera-engine/electron/eslint';
```

`chimeraPlugin` is the plugin object, carrying all eight rules. The monorepo's own root
config registers it directly, per rule and per zone. `standaloneLintConfig()` is the
games-facing half: the five rules that apply to game code, already mapped onto a game's own
directories.

---

## What a game gets, and what it does not

Five rules travel with a game. Three stay behind.

| Rule                         | Invariant | Where it fires in a game                                           |
| ---------------------------- | --------- | ------------------------------------------------------------------ |
| `no-fromfloat-in-simulation` | #76       | `simulation/**`, `ai/**` — OFF on `*.{test,spec}.{ts,tsx}` in both |
| `no-hardcoded-design-values` | #86, #91  | `screens/**` (TS/TSX) and `screens/**/*.module.css`                |
| `no-unknown-token-overrides` | #85       | `styles/tokens-override.css`                                       |
| `no-game-renderer-internals` | #96       | the whole app                                                      |
| `no-raw-r3f-canvas`          | #127      | the whole app                                                      |

The withheld three — `no-shell-games-import`, `no-main-games-import`,
`no-main-provider-internals` — guard boundaries internal to the engine. §4.32 records the
per-rule reasoning, and `curated-rules.ts` records it as data, so a rule dropped by accident
is distinguishable from one withheld on purpose.

Two facts the rule ids do not carry, and both are load-bearing:

- **Zones are app-root-relative.** A game runs `eslint .` from its own app root, so the
  globs read `simulation/**`, not the monorepo's `apps/<game>/simulation/**`.
- **Four of the five also need an `apps/<name>/` segment in the ABSOLUTE path**, because
  their own predicates read it. A scaffolded game satisfies that by living at
  `apps/<kebab>`; the same game at a bare project root loses `no-game-renderer-internals`,
  `no-raw-r3f-canvas`, and `no-unknown-token-overrides` silently, and `no-fromfloat-in-simulation` keeps only its
  simulation arm.

---

## Composing the preset

It is an **overlay, not a base**. It contributes the Chimera rule blocks and nothing else —
no recommended sets, no parser options, no global `ignores`. The game owns those.

```js
const base = [js.configs.recommended, ...tseslint.configs.recommended];

export default [
    { ignores: ['dist/**', 'renderer/out/**' /* … */] },
    ...base,
    ...standaloneLintConfig({ css, silenceOnCss: base }),
];
```

`create-chimera-game` emits exactly this shape, so a scaffolded game needs none of the
below — it is here for a game author editing that file.

### `silenceOnCss`, and why the base is passed twice

Two of the curated rules lint CSS, which needs the `@eslint/css` language. A flat config
applies **every** matching block, so a rule set with no `files` restriction — the idiomatic
shape; `js.configs.recommended` and `typescript-eslint`'s `base`/`recommended` all ship
unscoped — has its JS rules run against the stylesheet too.

That is not a false positive. It is a crash, and it does not degrade:

- `js.configs.recommended` → `no-irregular-whitespace` dies with
  `sourceCode.getAllComments is not a function`;
- any **type-checked** `typescript-eslint` set → `await-thenable` or `dot-notation` dies
  demanding type information for a `.css` file.

ESLint aborts the whole run, so one unhandled stylesheet means the game lints nothing at
all. The preset silences `js.configs.recommended` itself when it can resolve `@eslint/js` —
same direction, same caveat as `css` below. Everything else has to be named, because only
the game knows what it applies.

Pass the **whole** base. Entries that bring their own language are left alone — a game that
lints its own stylesheets keeps its `css/*` rules on the very files this preset governs.

### `css`

`@eslint/css` and `@eslint/js` are **optional** peer dependencies, required on demand rather
than imported at module scope: a module-top import would break `chimeraPlugin` too, for
every consumer who never asked for the preset. Passing `css` explicitly resolves it in your
project rather than from inside `node_modules/@chimera-engine/electron`, which is the
reliable direction under an isolated package linker.

---

## Where the base token set comes from

`no-unknown-token-overrides` reads the declared `--ch-*` names from
`@chimera-engine/renderer/styles/tokens.css` — through the package specifier, never a path
relative to this module. That distinction is what lets the rule leave the monorepo at all: a
module-relative reach resolves to wherever the file happens to sit, so it silently re-aims
when the rule moves and points at nothing from inside a published `dist/`.

The specifier lands on renderer's **built** `dist/styles/tokens.css`, so the renderer package
must be built (the monorepo's `lint` script builds first). The path is injectable through the
rule's `tokensCssPath` option, which is how the rule's own tests run without a build.

---

## Two things a green run does not tell you

- **An `off` entry suppresses ESLint's own refusal.** If a rule id in `silenceOnCss` is
  misspelled, the rule is set to `off` and never resolved — so the
  `Could not find plugin` error that would have named the typo does not appear.
- **The CSS arm widens what `eslint .` covers.** It pulls `.css` files into a run that
  previously skipped them. That is how the token rules reach them; it is also the one way
  this overlay adds to the game's lint surface rather than narrowing it.

---

## How this is proven

Reachability is not the claim — a `--print-config` probe shows every curated rule configured
on a scaffold whose zone globs match nothing, whose rules' own predicates never fire, or
whose plugin resolved to an empty object. All three have happened while building this.

So `verify:scaffold` runs the real command against an installed standalone probe, twice:
once on the untouched scaffold (which must be green), and once with a planted violation of
**every** curated rule — including both arms of the design-value rule — each of which must
come back named by its rule id, in its own file.

That second run asks for `-f json` and is read structurally, because rule id and file have
to be paired on one finding. In the human format they are two substrings of one blob, and
the two design-value plants share a rule id — so the file is the only thing telling the CSS
arm from the TS one.

---

## Cross-references

- [§4.32 Dev Tooling](../../../docs/core-components/dev-tooling.md) — the curation verdicts
  and the distribution rationale.
- [§3 Module Boundaries](../../../docs/coding-standards-sections/module-boundaries.md) — the
  boundaries these rules enforce.
- [§4.35 UI Design System](../../../docs/core-components/gameshell-ui-design-system.md) — the
  token contract behind `no-hardcoded-design-values` and `no-unknown-token-overrides`.
