/**
 * tools/docs-link-resolution.test.ts
 *
 * Anti-rot guard for relative links between tracked markdown files.
 *
 * A link between docs carries two claims, and they rot independently: that the
 * path names a file, and that the fragment names an anchor the target defines.
 * They are separate conjuncts here with their own killer fixtures, because a
 * link can name a real file and a missing anchor, or a real anchor spelling
 * under a path that resolves nowhere.
 *
 * The second claim is the easier one to get wrong by hand. A ledger of numbered
 * rules is a natural thing to deep-link into, and a `**45.**` list row is not a
 * heading — no renderer gives it an id, so the fragment resolves nowhere however
 * carefully it is spelled.
 *
 * What the guard reports is deliberately narrower than "GitHub would render this
 * link": it reports a fragment only when the target resolves under **no**
 * anchoring convention the repo uses — neither an explicit `{#id}` attribute
 * (`docs/security-trust/tactics-commitment-battle-mode.md` writes these and
 * links to them), nor an `<a id>`/`<a name>` element, nor the slug a heading
 * generates. A link that resolves under one convention and not another is left
 * alone; deciding between renderers is not this guard's job, and reporting it
 * here would make the guard's claim broader than what it measures.
 *
 * Scope limits, stated rather than left to be discovered:
 *
 * - Fragments are checked only when the target is a tracked markdown file. A
 *   `#L12` line ref into a `.ts` file is a real convention with no anchors to
 *   check against.
 * - Existence is measured against `git ls-files`, so a link into an untracked
 *   file is reported. That is the intent: it is broken for everyone who clones.
 * - Fenced code blocks are skipped, for links and for headings alike. Without
 *   the heading half, a `# comment` line inside an `sh` block would mint an
 *   anchor that no renderer emits, and the fragment conjunct would go quietly
 *   permissive.
 * - Link syntax quoted in an inline code span or commented out is not a link and
 *   is not resolved; a four-space-indented code block is not detected, and a
 *   link inside one would be. See `withoutInlineCode`.
 * - Only inline `[](…)`/`![](…)` links are visited. Reference-style definitions
 *   and HTML `<a href>`/`<img src>` are not.
 *
 * The repo-wide pass is pinned by anti-vacuity floors on all three counts it
 * depends on. A regex that stopped matching, or a `ls-files` glob that stopped
 * reaching the docs tree, would otherwise turn the whole check into a pass over
 * an empty list.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The lowest totals this guard may see before it is measuring nothing. Measured
 * at the tree that introduced it: 213 markdown files, 905 path resolutions, 27
 * fragment resolutions. The floors sit below those rather than on them because
 * deleting a doc or a link is ordinary and must not fail this guard — the margin
 * is what an edit may remove, not what a parse may silently stop matching.
 */
const MINIMUM_MARKDOWN_FILES = 150;
const MINIMUM_PATHS_CHECKED = 700;
const MINIMUM_FRAGMENTS_CHECKED = 15;

/** A markdown link or image: `[text](target)`, with an optional `"title"`. */
const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
/** A fenced code block delimiter. Both fence characters markdown allows. */
const FENCE = /^\s*(?:```|~~~)/;
/** An ATX heading, captured without its `#` run. */
const HEADING = /^\s*#{1,6}\s+(.*)$/;
/** An explicit anchor attribute: `## Reveal ordering {#reveal-ordering}`. */
const EXPLICIT_ID = /\{#([^}\s]+)\}/g;
/** An inline anchor element: `<a id="x">` or `<a name="x">`. */
const ANCHOR_ELEMENT = /<a\s[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
/** Targets this guard does not resolve: other schemes, and bare protocol refs. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

interface DocsTree {
    /** Repo-relative path → content, for every tracked markdown file. */
    readonly markdown: ReadonlyMap<string, string>;
    /** Every repo-relative path in the tree — tracked files and their directories. */
    readonly paths: ReadonlySet<string>;
}

interface LinkAudit {
    /** One exact message per unresolvable link, so fixtures assert the matched set. */
    readonly problems: readonly string[];
    /** Relative links whose path half was resolved. */
    readonly pathsChecked: number;
    /** Links whose fragment half was resolved against a markdown target. */
    readonly fragmentsChecked: number;
}

/**
 * Blank the spans where link syntax is shown rather than used: an inline code
 * span quoting a link, and a commented-out link. Neither renders as a link, so
 * reporting either would fail the gate on a doc that merely explains the syntax.
 *
 * Applied to link extraction only — `anchorsOf` needs a heading's code-span text
 * intact, since GitHub slugs the text inside the backticks.
 *
 * Not covered: a four-space-indented code block. Telling one from an ordinary
 * indented continuation line needs the block structure this line-wise scan does
 * not carry.
 */
function withoutInlineCode(text: string): string {
    return text.replace(/<!--[\s\S]*?-->/g, '').replace(/`[^`\n]*`/g, '');
}

/** Drop fenced regions, keeping line positions so nothing else has to shift. */
function withoutFences(markdown: string): string[] {
    const lines = markdown.split('\n');
    const kept: string[] = [];
    let inFence = false;
    for (const line of lines) {
        if (FENCE.test(line)) {
            inFence = !inFence;
            kept.push('');
            continue;
        }
        kept.push(inFence ? '' : line);
    }
    return kept;
}

/**
 * The slug GitHub generates for a heading: markup reduced to its text,
 * lowercased, everything outside letters/digits/space/`_`/`-` removed, spaces
 * hyphenated.
 *
 * Two asymmetries make this look wrong and are load-bearing. Each space becomes
 * its own hyphen — runs are **not** collapsed — so dropping an `&` or `→` from
 * between two words leaves the two spaces that flanked it and yields a doubled
 * hyphen. For the same reason there is no `trim()`: a heading whose text ends in
 * a dropped character keeps a trailing hyphen. Both are what a reader copying
 * GitHub's heading permalink gets, and each has its own fixture below.
 *
 * `_` survives, because it is one of the characters GitHub keeps. Stripping it
 * as an emphasis marker would be wrong twice over: a lone or intraword `_` is
 * not emphasis, and `*`/`~` are already removed by the character class below.
 */
function slugify(headingText: string): string {
    return headingText
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .replace(/ /g, '-');
}

/**
 * Every fragment the target file could answer to, under any convention in use
 * here: an explicit `{#id}` attribute, an `<a id>`/`<a name>` element, the slug
 * GitHub generates from the heading as written, and the slug an attribute-aware
 * renderer generates from the same heading with its `{#id}` removed.
 *
 * The last two are both registered because which one a given renderer emits is
 * exactly the question this guard declines to decide. Only GitHub's own slug is
 * counted for repeat suffixing (`-1`, `-2` … in document order), since that is
 * the convention the counter belongs to — which is why this cannot be a pure
 * per-heading function.
 */
function anchorsOf(markdown: string): Set<string> {
    const anchors = new Set<string>();
    const slugCounts = new Map<string, number>();
    const lines = withoutFences(markdown);

    for (const line of lines) {
        for (const match of line.matchAll(ANCHOR_ELEMENT)) {
            anchors.add((match[1] ?? '').toLowerCase());
        }
        const heading = HEADING.exec(line);
        if (heading === null) continue;
        const text = heading[1] ?? '';

        for (const explicit of text.matchAll(EXPLICIT_ID)) {
            anchors.add((explicit[1] ?? '').toLowerCase());
        }

        // The visible text an attribute-aware renderer slugs: the attribute is
        // markup, so it goes, and with it the space it leaves behind.
        const visible = slugify(text.replace(/\{#[^}\s]+\}/g, '').trim());
        if (visible.length > 0) anchors.add(visible);

        const slug = slugify(text);
        if (slug.length === 0) continue;
        const seen = slugCounts.get(slug) ?? 0;
        slugCounts.set(slug, seen + 1);
        anchors.add(seen === 0 ? slug : `${slug}-${seen}`);
    }
    return anchors;
}

/** Percent-decode a link half, leaving it as written if it is not valid encoding. */
function decode(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/**
 * Resolve every relative link in the tree, reporting the ones that land on no
 * file and the ones that land on a markdown file defining no such anchor.
 */
function auditLinks(tree: DocsTree): LinkAudit {
    const problems: string[] = [];
    const anchorCache = new Map<string, Set<string>>();
    let pathsChecked = 0;
    let fragmentsChecked = 0;

    const anchorsFor = (file: string): Set<string> => {
        const cached = anchorCache.get(file);
        if (cached !== undefined) return cached;
        const computed = anchorsOf(tree.markdown.get(file) ?? '');
        anchorCache.set(file, computed);
        return computed;
    };

    for (const source of [...tree.markdown.keys()].sort()) {
        const body = withoutInlineCode(withoutFences(tree.markdown.get(source) ?? '').join('\n'));

        for (const match of body.matchAll(LINK)) {
            const target = match[1] ?? '';
            if (EXTERNAL.test(target)) continue;

            const hash = target.indexOf('#');
            const rawPath = hash === -1 ? target : target.slice(0, hash);
            const fragment = hash === -1 ? '' : decode(target.slice(hash + 1)).toLowerCase();

            let targetFile: string;
            if (rawPath.length === 0) {
                targetFile = source;
            } else {
                const relative = decode(rawPath);
                // A leading `/` is repo-root-relative on GitHub, not filesystem-absolute.
                const resolved = relative.startsWith('/')
                    ? path.posix.normalize(relative.slice(1))
                    : path.posix.normalize(path.posix.join(path.posix.dirname(source), relative));
                targetFile = resolved.replace(/\/$/, '');
                pathsChecked += 1;
                if (!tree.paths.has(targetFile)) {
                    problems.push(`${source} → ${target} (no such path: ${targetFile})`);
                    continue;
                }
            }

            if (fragment.length === 0) continue;
            // Only a markdown target has anchors this guard can enumerate.
            if (!tree.markdown.has(targetFile)) continue;
            fragmentsChecked += 1;
            if (!anchorsFor(targetFile).has(fragment)) {
                problems.push(
                    `${source} → ${target} (${targetFile} defines no anchor "${fragment}")`,
                );
            }
        }
    }

    return { problems, pathsChecked, fragmentsChecked };
}

/** Build a synthetic tree from `path → content`; directories are derived. */
function treeOf(files: Record<string, string>): DocsTree {
    const markdown = new Map<string, string>();
    const paths = new Set<string>();
    for (const [file, content] of Object.entries(files)) {
        paths.add(file);
        if (file.endsWith('.md')) markdown.set(file, content);
        let dir = path.posix.dirname(file);
        while (dir !== '.' && dir !== '/') {
            paths.add(dir);
            dir = path.posix.dirname(dir);
        }
    }
    return { markdown, paths };
}

/** The real tree, read through `git ls-files` so untracked files do not count. */
function repoTree(): DocsTree {
    const tracked = execFileSync('git', ['ls-files', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })
        .split('\0')
        .filter((file) => file.length > 0);

    const markdown = new Map<string, string>();
    const paths = new Set<string>();
    for (const file of tracked) {
        paths.add(file);
        if (file.endsWith('.md')) {
            markdown.set(file, readFileSync(path.join(repoRoot, file), 'utf8'));
        }
        let dir = path.posix.dirname(file);
        while (dir !== '.' && dir !== '/') {
            paths.add(dir);
            dir = path.posix.dirname(dir);
        }
    }
    return { markdown, paths };
}

describe('docs link resolution — the checker', () => {
    it('reports nothing for a link whose path and fragment both resolve', () => {
        // Positive control: without it, a checker that reported everything would
        // satisfy every fixture below.
        const audit = auditLinks(
            treeOf({
                'docs/a.md': '[ledger](../exec/inv.md#invariants-4160)',
                'exec/inv.md': '## Invariants 41–60',
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.pathsChecked).toBe(1);
        expect(audit.fragmentsChecked).toBe(1);
    });

    it('catches a link whose path resolves to no file', () => {
        // The path half of the defect above: the ledger is one directory over,
        // so `./` names a file that has never existed.
        expect(
            auditLinks(
                treeOf({
                    'docs/core/pipeline.md': '[inv](./architecture-invariants.md)',
                    'docs/exec/architecture-invariants.md': '# Architecture Invariants',
                }),
            ).problems,
        ).toEqual([
            'docs/core/pipeline.md → ./architecture-invariants.md (no such path: docs/core/architecture-invariants.md)',
        ]);
    });

    it('catches a fragment the target file defines no anchor for', () => {
        // The fragment half, isolated: the path here is correct, so only the
        // fragment conjunct can see it. `**45.**` is a list row, and no renderer
        // gives a list row an id.
        expect(
            auditLinks(
                treeOf({
                    'docs/core/pipeline.md': '[inv](../exec/inv.md#invariant-45)',
                    'docs/exec/inv.md': '## Invariants 41–60\n\n**45.** idempotency\n',
                }),
            ).problems,
        ).toEqual([
            'docs/core/pipeline.md → ../exec/inv.md#invariant-45 (docs/exec/inv.md defines no anchor "invariant-45")',
        ]);
    });

    it('resolves a fragment against an explicit {#id} attribute', () => {
        // The convention `tactics-commitment-battle-mode.md` uses. Without this,
        // the guard would report four links in that file that do resolve.
        const audit = auditLinks(
            treeOf({
                'docs/m.md': '## 5. Reveal ordering (T9) {#reveal-ordering}\n[r](#reveal-ordering)',
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.fragmentsChecked).toBe(1);
    });

    it('resolves a fragment against the second of two ids on one heading', () => {
        // That doc writes `{#nonce-retention}{#nonce-retention-additive}` and
        // links to the second. A parse taking only the first id would miss it.
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md':
                        '## Nonce-retention {#nonce-retention}{#nonce-retention-additive}\n[n](#nonce-retention-additive)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('resolves a fragment against an <a id> element', () => {
        expect(
            auditLinks(treeOf({ 'docs/m.md': '<a id="hand-written"></a>\n\n[h](#hand-written)' }))
                .problems,
        ).toEqual([]);
    });

    // Fragments are matched case-insensitively, which takes a lowercasing step on
    // each side. The three below are separate conjuncts — an anchor arrives from
    // a heading slug, from a `{#id}`, or from an `<a id>` — so each gets its own
    // fixture.

    it('matches a capitalised fragment against a heading slug', () => {
        // The link half. `slugify` lowercases, so without the fragment's own
        // lowercasing a link written in the heading's capitalisation is reported.
        expect(
            auditLinks(treeOf({ 'docs/m.md': '## Section Two\n[a](#Section-Two)' })).problems,
        ).toEqual([]);
    });

    it('matches a capitalised fragment against an explicit {#id}', () => {
        // The id deliberately does not restate the heading: were it
        // `## Nonce retention`, the visible-text arm would slug to the same
        // anchor and resolve the link by itself, leaving this arm unmeasured.
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md': '## Retention {#Nonce-Retention}\n[a](#nonce-retention)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('matches a capitalised fragment against an <a id> element', () => {
        expect(
            auditLinks(treeOf({ 'docs/m.md': '<a id="Hand-Written"></a>\n\n[h](#hand-written)' }))
                .problems,
        ).toEqual([]);
    });

    it('keeps the visible-text slug of a heading that also carries an explicit id', () => {
        // The attribute-aware renderer's arm: it treats `{#ro}` as markup, so the
        // slug comes from the text left behind. Which convention a renderer emits
        // is the question this guard declines to decide, so both resolve.
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md': '## Reveal ordering {#ro}\n[a](#ro)\n[b](#reveal-ordering)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('keeps the as-written slug of a heading that also carries an explicit id', () => {
        // The other arm, and the one a reader copying a GitHub permalink lands
        // on: GitHub has no `{#id}` support, so it slugs the attribute text too.
        // Stripping the attribute inside `slugify` instead of registering this
        // separately would leave `#reveal-ordering-ro` reported as unresolvable.
        expect(
            auditLinks(
                treeOf({ 'docs/m.md': '## Reveal ordering {#ro}\n[a](#reveal-ordering-ro)' }),
            ).problems,
        ).toEqual([]);
    });

    it('suffixes a repeated heading slug with an ascending counter', () => {
        const audit = auditLinks(
            treeOf({
                'docs/m.md':
                    '## Notes\n## Notes\n[first](#notes)\n[second](#notes-1)\n[third](#notes-2)',
            }),
        );
        expect(audit.problems).toEqual([
            'docs/m.md → #notes-2 (docs/m.md defines no anchor "notes-2")',
        ]);
    });

    it('leaves a doubled hyphen where a dropped character sat between two spaces', () => {
        // The killer for collapsing whitespace runs: with `\s+` the slug would be
        // `cue-fade-crossfade`, and every link written in the doubled form below
        // would be reported as unresolvable. Headings in this tree are linked
        // that way; the repo-wide test is what measures how many.
        expect(
            auditLinks(
                treeOf({ 'docs/m.md': '## Cue fade & crossfade\n[a](#cue-fade--crossfade)' }),
            ).problems,
        ).toEqual([]);
    });

    it('keeps an underscore in a heading slug rather than reading it as emphasis', () => {
        // `_` is one of the characters GitHub keeps. Stripping it as an emphasis
        // marker would report the permalink GitHub itself serves for this
        // heading.
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md':
                        '## §13.10 CHIMERA_E2E Flag Contract\n[a](#1310-chimera_e2e-flag-contract)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('keeps the trailing hyphen of a heading whose text ends in a dropped character', () => {
        // The `trim()` mutant: GitHub hyphenates the space a dropped character
        // leaves at the end exactly as it does one in the middle. Trimming it
        // would report the link below, which is the permalink GitHub serves.
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md':
                        '## Why the standalone form passes `../..`\n[a](#why-the-standalone-form-passes-)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('strips code spans, emphasis and links out of a heading slug', () => {
        expect(
            auditLinks(
                treeOf({
                    'docs/m.md': '## The `reduce()` **contract**\n[a](#the-reduce-contract)',
                }),
            ).problems,
        ).toEqual([]);
    });

    it('ignores a link inside a fenced code block', () => {
        // An illustrative link in a code example is not a claim about the tree.
        expect(
            auditLinks(treeOf({ 'docs/m.md': '```md\n[example](./nowhere.md)\n```\n' })).problems,
        ).toEqual([]);
    });

    it('does not mint an anchor from a comment line inside a fenced block', () => {
        // `# Architecture Invariants` inside an `sh` block is a shell comment.
        // Reading it as a heading would make the fragment conjunct permissive.
        expect(
            auditLinks(treeOf({ 'docs/m.md': '```sh\n# Deploy notes\n```\n[d](#deploy-notes)' }))
                .problems,
        ).toEqual(['docs/m.md → #deploy-notes (docs/m.md defines no anchor "deploy-notes")']);
    });

    it('percent-decodes both halves of a target before resolving them', () => {
        // Killer for dropping the decode: without it the path stays the literal
        // `my%20file.md` and the fragment the literal `%c3%a4rger`. A space is
        // the encoding a path carries; a fragment only ever needs it for
        // non-ASCII, since a space in a heading is already a hyphen in the slug.
        const audit = auditLinks(
            treeOf({
                'docs/m.md': '[a](./my%20file.md#%C3%A4rger)',
                'docs/my file.md': '## Ärger',
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.fragmentsChecked).toBe(1);
    });

    it('reads a target with malformed percent-encoding as written', () => {
        // The `catch` arm: `decodeURIComponent` throws on a lone `%`, and the
        // target must still be resolved rather than crash the scan.
        expect(auditLinks(treeOf({ 'docs/m.md': '[a](./100%.md)' })).problems).toEqual([
            'docs/m.md → ./100%.md (no such path: docs/100%.md)',
        ]);
    });

    it('ignores link syntax quoted in an inline code span or commented out', () => {
        // Neither renders as a link, so neither is a claim about the tree.
        const audit = auditLinks(
            treeOf({
                'docs/m.md': [
                    'Write it as `[text](./missing.md)` in prose.',
                    '<!-- [text](./also-missing.md) -->',
                ].join('\n'),
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.pathsChecked).toBe(0);
    });

    it('still slugs the text inside a heading code span', () => {
        // The blanking above is scoped to link extraction; applying it to
        // headings would empty this slug and report the link.
        expect(
            auditLinks(
                treeOf({ 'docs/m.md': '## The `reduce` contract\n[a](#the-reduce-contract)' }),
            ).problems,
        ).toEqual([]);
    });

    it('leaves external and non-relative targets alone', () => {
        const audit = auditLinks(
            treeOf({
                'docs/m.md': [
                    '[w](https://example.com/x.md#nope)',
                    '[m](mailto:a@b.c)',
                    '[p](//cdn.example.com/x.md)',
                ].join('\n'),
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.pathsChecked).toBe(0);
    });

    it('resolves a link to a directory and to a non-markdown file', () => {
        // Both shapes occur in the tree; neither has anchors to check.
        const audit = auditLinks(
            treeOf({
                'docs/m.md': '[dir](../src/utils/)\n[code](../src/utils/rng.ts)',
                'src/utils/rng.ts': 'export const x = 1;',
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.pathsChecked).toBe(2);
        expect(audit.fragmentsChecked).toBe(0);
    });

    it('skips the fragment half of a link into a non-markdown file', () => {
        // `#L12` is a line ref, not an anchor this guard can enumerate.
        const audit = auditLinks(
            treeOf({
                'docs/m.md': '[line](../src/rng.ts#L12)',
                'src/rng.ts': 'export const x = 1;',
            }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.fragmentsChecked).toBe(0);
    });

    it('reads a root-relative target from the repo root, not the filesystem root', () => {
        expect(
            auditLinks(
                treeOf({ 'docs/deep/m.md': '[a](/docs/other.md)', 'docs/other.md': '# Other' }),
            ).problems,
        ).toEqual([]);
    });

    it('reports an image whose source is missing', () => {
        expect(auditLinks(treeOf({ 'docs/m.md': '![logo](./logo.png)' })).problems).toEqual([
            'docs/m.md → ./logo.png (no such path: docs/logo.png)',
        ]);
    });

    it('reads a target written with a title or in angle brackets', () => {
        const audit = auditLinks(
            treeOf({ 'docs/m.md': '[a](./o.md "The title")\n[b](<./o.md>)', 'docs/o.md': '# O' }),
        );
        expect(audit.problems).toEqual([]);
        expect(audit.pathsChecked).toBe(2);
    });

    it('reports a link into a file that exists but is untracked', () => {
        // `git ls-files` is the existence oracle: an untracked target is broken
        // for everyone who clones, however well it resolves on this machine.
        expect(auditLinks(treeOf({ 'docs/m.md': '[a](./scratch.md)' })).problems).toEqual([
            'docs/m.md → ./scratch.md (no such path: docs/scratch.md)',
        ]);
    });
});

describe('the tracked markdown tree', () => {
    // Read once, and inside the tests rather than during collection: a `git`
    // failure or an unreadable file here would otherwise fail the whole file and
    // erase every checker fixture above from the run.
    let measured: { tree: DocsTree; audit: LinkAudit } | undefined;
    const measure = (): { tree: DocsTree; audit: LinkAudit } => {
        if (measured === undefined) {
            const tree = repoTree();
            measured = { tree, audit: auditLinks(tree) };
        }
        return measured;
    };

    it('resolves enough links for the check below to mean anything', () => {
        // Without this, a `ls-files` or link regex that stopped matching would
        // turn the assertion below into a pass over an empty list.
        const { tree, audit } = measure();
        expect(tree.markdown.size).toBeGreaterThanOrEqual(MINIMUM_MARKDOWN_FILES);
        expect(audit.pathsChecked).toBeGreaterThanOrEqual(MINIMUM_PATHS_CHECKED);
        expect(audit.fragmentsChecked).toBeGreaterThanOrEqual(MINIMUM_FRAGMENTS_CHECKED);
    });

    it('has no inline link landing on a missing file or an undefined anchor', () => {
        // Inline `[](…)` and `![](…)` only. Reference-style links and HTML
        // `<a href>`/`<img src>` are not visited.
        expect(measure().audit.problems).toEqual([]);
    });
});
