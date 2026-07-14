/**
 * Pure name-normalisation core for the `create-chimera-game` scaffolder.
 *
 * A new game is named once on the command line; the blank template references that name in
 * six different casings. {@link normalizeGameName} expands a single input — in any shape
 * (kebab, camel, Pascal, CONSTANT, space-separated) — into all six deterministically, so no
 * downstream task ever has to hardcode a game name or re-derive a casing.
 *
 * This module is intentionally dependency-free: no `fs`, no `process`, no CLI concerns, and no
 * imports from any `@chimera-engine/*` package. It is the leaf the rest of the scaffolder builds on.
 */

/** A game name expanded into every casing the blank template references. */
export interface GameNames {
    /** kebab-case — e.g. `my-game` / `tactics`. */
    kebab: string;
    /** camelCase — e.g. `myGame` / `tactics`. */
    camel: string;
    /** PascalCase — e.g. `MyGame` / `Tactics`. */
    pascal: string;
    /** Title Case — e.g. `My Game` / `Tactics`. */
    title: string;
    /** CONSTANT_CASE — e.g. `MY_GAME` / `TACTICS`. */
    constant: string;
    /** lower (no separators) — e.g. `mygame` / `tactics`. */
    lower: string;
}

/** Thrown when a game name cannot be normalised. The message names the offending input. */
export class InvalidGameNameError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidGameNameError';
    }
}

/** Only ASCII letters/digits and `-` `_` space separators are permitted in a raw name. */
const ALLOWED_CHARS = /^[A-Za-z0-9 _-]+$/;

/**
 * Split any input shape into a lowercased word list.
 *
 * Separators (`-`, `_`, whitespace) and camelCase humps (a lowercase/digit followed by an
 * uppercase letter) both mark word boundaries. Acronym runs (e.g. `XMLParser`) are treated as
 * a single word — acceptable for game names, which are not expected to embed acronyms.
 */
function splitWords(input: string): string[] {
    return input
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[-_\s]+/)
        .filter((word) => word.length > 0)
        .map((word) => word.toLowerCase());
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Normalise a single game name into all six {@link GameNames} casings.
 *
 * Rejects (with {@link InvalidGameNameError}) names that are empty, contain characters outside
 * `[A-Za-z0-9]` and `-` `_` space, lack any ASCII letter, or begin with a digit — the casings
 * are used as JavaScript identifiers (e.g. `myGameContribution`), which must start with a
 * letter.
 */
export function normalizeGameName(input: string): GameNames {
    const trimmed = input.trim();

    if (trimmed === '') {
        throw new InvalidGameNameError('Game name must not be empty.');
    }
    if (!ALLOWED_CHARS.test(trimmed)) {
        throw new InvalidGameNameError(
            `Invalid game name "${input}": only letters, digits, and "-" "_" space separators are allowed.`,
        );
    }
    if (!/[A-Za-z]/.test(trimmed)) {
        throw new InvalidGameNameError(
            `Invalid game name "${input}": must contain at least one letter.`,
        );
    }
    if (/^[0-9]/.test(trimmed)) {
        throw new InvalidGameNameError(
            `Invalid game name "${input}": must start with a letter (casings are used as identifiers).`,
        );
    }

    const words = splitWords(trimmed);

    return {
        kebab: words.join('-'),
        camel: words[0] + words.slice(1).map(capitalize).join(''),
        pascal: words.map(capitalize).join(''),
        title: words.map(capitalize).join(' '),
        constant: words.map((word) => word.toUpperCase()).join('_'),
        lower: words.join(''),
    };
}
