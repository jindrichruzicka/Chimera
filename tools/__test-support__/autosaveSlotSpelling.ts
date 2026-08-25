// tools/__test-support__/autosaveSlotSpelling.ts
//
// The judgement `tools/autosave-slot-spelling.test.ts` makes, separated from
// the tree walk that feeds it so it can be handed source text directly.
//
// Read against the live tree it is exercised almost entirely in the negative —
// exactly one production file may spell the slot, which is the point of the
// census — so a predicate that widened until it cleared everything would go
// unnoticed there. The synthetic cases in that file are what pin it.
//
// Parsed rather than grepped, because the tree is full of PROSE about the
// autosave slot: `SaveFile.ts`, `SaveRepository.ts`, `InMemorySaveRepository.ts`
// and `HostSessionPipeline.ts` all name it in comments, several inside quotes.
// A text scan would have to model comments to tell those from code; the parser
// does not see them at all, because comments are not nodes.

import ts from 'typescript';

/**
 * The reserved slot's name, assembled at runtime so this module's own source
 * text never contains it contiguously. Belt and braces: the walk already skips
 * `__test-support__/`, and that exclusion has its own pin in the census file.
 */
const SLOT_TOKEN = `auto${'save'}`;

/**
 * Whether `text` spells the slot where a slot id would carry it: as a whole
 * `'/'`-delimited segment.
 *
 * The segment rule is what separates an id from English. Log messages say
 * "autosave failed after engine:end_turn" and "autosave failed during crash
 * handling"; both contain the name, neither is a spelling of the id, and a
 * plain substring test reported both. A neighbouring slot name such as
 * `'pre-autosave'` is likewise its own name, not this one.
 */
function spellsSlotSegment(text: string): boolean {
    return text.split('/').includes(SLOT_TOKEN);
}

/**
 * Every string the source spells that carries the autosave slot name as a path
 * segment.
 *
 * Reads STRING VALUES only — plain literals, template literals, and the fixed
 * spans of a template with substitutions — so identifiers (`autoSave`),
 * property names (`autoSaveIntervalTurns`) and comments are all invisible to
 * it. Matching is case-sensitive, so the camelCase settings keys never match.
 *
 * SCOPE, narrower than the name reads at a glance: this finds SPELLINGS, not
 * every possible construction. A slot id assembled from pieces (`'auto' +
 * 'save'`, a name read from config) is invisible here, as it would be to any
 * source-level check. What the census buys is that the ordinary way to write it
 * down a second time fails.
 *
 * @param source TypeScript or TSX source text
 * @param fileName used only to pick the TSX parse mode
 * @returns the offending strings, in source order; empty when the file spells
 *   the slot nowhere
 */
export function autosaveSlotSpellings(source: string, fileName = 'input.ts'): string[] {
    const parsed = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (spellsSlotSegment(node.text)) {
                found.push(node.text);
            }
        } else if (ts.isTemplateExpression(node)) {
            // A template with substitutions holds its fixed text in the head
            // and in each span's literal — `${gameId}/autosave` puts the whole
            // spelling in the LAST span, which a head-only check would miss.
            const spans = [node.head, ...node.templateSpans.map((span) => span.literal)];
            for (const span of spans) {
                if (spellsSlotSegment(span.text)) {
                    found.push(span.text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(parsed);
    return found;
}
