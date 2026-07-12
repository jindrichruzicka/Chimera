// renderer/i18n/format-message.ts
//
// Pure ICU-subset message formatter: turns a resolved translation template
// (as produced by translation-bundle.ts's resolveTranslation) plus a params
// object into the final display string. Framework-free — no React, no
// simulation/ai runtime, no Electron, no game module. `Intl` is the one
// external surface this module uses; it is renderer-only and never reaches
// the deterministic simulation core.

/** Named values a template's placeholders may substitute. */
export type MessageParams = Readonly<Record<string, string | number>>;

interface Branch {
    readonly key: string;
    readonly body: string;
}

/**
 * A parse failure internal to this module. Every throw site inside the
 * recursive parsing helpers uses this class; {@link formatMessage} is the
 * sole catch site, which is what lets the parsing logic below use early-exit
 * throws instead of threading a Result type through every recursive call
 * while still keeping the public function's "never throws" contract.
 */
class MalformedTemplateError extends Error {}

/**
 * Format an ICU-subset template against params. Pure; never throws on a
 * well-formed template — unknown params render as the empty string and are
 * dev-warn logged; a malformed template falls back to the raw template text.
 *
 * Supports named `{param}` interpolation, `{{`/`}}` brace escapes,
 * `{n, plural, one{…} other{…}}` (categories resolved via
 * `Intl.PluralRules(locale)`, never hard-coded English rules; `=N` exact
 * categories take precedence), and `{g, select, key{…} other{…}}`.
 */
export function formatMessage(template: string, params?: MessageParams, locale = 'en'): string {
    try {
        return formatSegment(template, params, locale, undefined);
    } catch (error) {
        if (error instanceof MalformedTemplateError) {
            console.warn(
                `[formatMessage] malformed template (${error.message}), returning raw text`,
                template,
            );
            return template;
        }
        throw error;
    }
}

// Shared recursive core: formats one segment of template text (either the
// full top-level template, or a plural/select branch body). Branch bodies
// need the same escape/interpolation handling as the top level, which is why
// this is a single shared scanner rather than two separate code paths.
//
// `poundValue` is the count of the nearest enclosing plural, or undefined at
// the top level / inside a select. Substituting `#` here — in the same scan
// that resolves escapes and nested placeholders — is what makes a bare `#`
// bind to the innermost plural: a nested plural recurses with its own count,
// shadowing the outer one. A `#` is a plain literal (no substitution) only
// when there is no enclosing plural (poundValue undefined); `{{`/`}}` escape
// literal braces, not `#`, so a `#` adjacent to an escape is still the count.
function formatSegment(
    text: string,
    params: MessageParams | undefined,
    locale: string,
    poundValue: string | undefined,
): string {
    const out: string[] = [];
    let i = 0;
    while (i < text.length) {
        if (text.startsWith('{{', i)) {
            out.push('{');
            i += 2;
        } else if (text.startsWith('}}', i)) {
            out.push('}');
            i += 2;
        } else if (text[i] === '{') {
            const [body, nextIndex] = scanBalancedBraces(text, i + 1);
            out.push(formatPlaceholder(body, params, locale, poundValue));
            i = nextIndex;
        } else if (text[i] === '#' && poundValue !== undefined) {
            out.push(poundValue);
            i += 1;
        } else {
            out.push(text.charAt(i));
            i += 1;
        }
    }
    return out.join('');
}

// Scans forward from `startIndex` (just past an opening `{`) for its
// matching `}`, tracking brace depth so a nested construct like
// `{count, plural, one {# item}}` is consumed as one placeholder body rather
// than closing early on its first inner `}`. Every brace here is structural
// (placeholder/branch delimiters), never a `{{`/`}}` literal escape — those
// only apply to plain literal text, handled separately in formatSegment.
// Returns the captured body text and the index just past the closing brace.
function scanBalancedBraces(text: string, startIndex: number): [string, number] {
    let depth = 1;
    let i = startIndex;
    while (i < text.length) {
        if (text[i] === '{') {
            depth += 1;
        } else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return [text.slice(startIndex, i), i + 1];
            }
        }
        i += 1;
    }
    throw new MalformedTemplateError('unbalanced brace');
}

function formatPlaceholder(
    body: string,
    params: MessageParams | undefined,
    locale: string,
    poundValue: string | undefined,
): string {
    const firstComma = findTopLevelComma(body, 0);
    if (firstComma === -1) {
        const name = body.trim();
        const value = params?.[name];
        if (value === undefined) {
            console.warn(
                `[formatMessage] unknown param "${name}" in template; rendering empty string`,
            );
            return '';
        }
        return String(value);
    }

    const name = body.slice(0, firstComma).trim();
    const rest = body.slice(firstComma + 1);
    const secondComma = findTopLevelComma(rest, 0);
    if (secondComma === -1) {
        throw new MalformedTemplateError('placeholder has a name but no construct kind');
    }
    const kind = rest.slice(0, secondComma).trim();
    const branchesText = rest.slice(secondComma + 1);

    if (kind === 'select') {
        // A select does not introduce its own count, so `#` in its branches
        // stays bound to the enclosing plural's count (if any).
        return formatSelect(name, branchesText, params, locale, poundValue);
    }
    if (kind === 'plural') {
        return formatPlural(name, branchesText, params, locale);
    }
    throw new MalformedTemplateError(`unrecognized construct "${kind}"`);
}

// Finds the index of the next top-level comma in `text` starting at `from`
// — one not nested inside a `{...}` branch body — or -1 if none exists.
// Operates on placeholder-body text, where braces are always structural.
function findTopLevelComma(text: string, from: number): number {
    let depth = 0;
    let i = from;
    while (i < text.length) {
        if (text[i] === '{') {
            depth += 1;
        } else if (text[i] === '}') {
            depth -= 1;
        } else if (text[i] === ',' && depth === 0) {
            return i;
        }
        i += 1;
    }
    return -1;
}

function parseBranches(branchesText: string): readonly Branch[] {
    const branches: Branch[] = [];
    let i = 0;
    while (i < branchesText.length) {
        while (i < branchesText.length && /\s/.test(branchesText.charAt(i))) {
            i += 1;
        }
        if (i >= branchesText.length) {
            break;
        }
        const keyStart = i;
        while (i < branchesText.length && branchesText[i] !== '{') {
            i += 1;
        }
        if (i >= branchesText.length) {
            throw new MalformedTemplateError('branch missing body');
        }
        const key = branchesText.slice(keyStart, i).trim();
        const [body, nextIndex] = scanBalancedBraces(branchesText, i + 1);
        branches.push({ key, body });
        i = nextIndex;
    }
    if (branches.length === 0 || !branches.some((branch) => branch.key === 'other')) {
        throw new MalformedTemplateError('missing required "other" branch');
    }
    return branches;
}

// Looks up the "other" branch in a list already validated by parseBranches
// to contain one, so callers can treat the result as always present.
function findOtherBranch(branches: readonly Branch[]): Branch {
    const other = branches.find((branch) => branch.key === 'other');
    if (other === undefined) {
        throw new MalformedTemplateError('missing required "other" branch');
    }
    return other;
}

function formatSelect(
    name: string,
    branchesText: string,
    params: MessageParams | undefined,
    locale: string,
    poundValue: string | undefined,
): string {
    const branches = parseBranches(branchesText);
    const value = params?.[name];
    const selected =
        value === undefined ? undefined : branches.find((branch) => branch.key === String(value));
    // parseBranches guarantees an "other" branch exists, so this always resolves.
    const winner = selected ?? findOtherBranch(branches);
    return formatSegment(winner.body, params, locale, poundValue);
}

function formatPlural(
    name: string,
    branchesText: string,
    params: MessageParams | undefined,
    locale: string,
): string {
    const branches = parseBranches(branchesText);
    const rawValue = params?.[name];
    const numericValue = rawValue === undefined ? NaN : Number(rawValue);
    if (!Number.isFinite(numericValue)) {
        throw new MalformedTemplateError(`plural pivot param "${name}" is missing or not a number`);
    }

    const exactMatch = branches.find(
        (branch) => branch.key.startsWith('=') && Number(branch.key.slice(1)) === numericValue,
    );
    const category = exactMatch ? undefined : new Intl.PluralRules(locale).select(numericValue);
    const keywordMatch =
        category === undefined ? undefined : branches.find((branch) => branch.key === category);
    // parseBranches guarantees an "other" branch exists, so this always resolves.
    const winner = exactMatch ?? keywordMatch ?? findOtherBranch(branches);

    // This plural's own count becomes the `#` value for its branch body,
    // shadowing any enclosing plural's count so `#` binds to the nearest one.
    return formatSegment(winner.body, params, locale, String(numericValue));
}
