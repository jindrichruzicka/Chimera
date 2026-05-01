/**
 * tools/eslint-plugin-chimera/rules/no-fromfloat-in-simulation.ts
 *
 * ESLint rule: `chimera/no-fromfloat-in-simulation`
 *
 * Flags any call to `fromFloat` whose binding was imported from
 * `simulation/engine/FixedPoint` (or any path that resolves to it) when the
 * call site is inside `simulation/**` — EXCEPT files under
 * `simulation/content/loaders/**`.
 *
 * Architecture reference: §4.31 — Fixed-Point Math (Q32.32)
 * Invariant #76: fromFloat() is permitted only at content-load time; must not
 *   be called inside validate(), reduce(), or any hot simulation path.
 *
 * Secondary check (Program:exit): a bare
 *   `// eslint-disable-next-line chimera/no-fromfloat-in-simulation`
 * without a companion `// @chimera-review: <reason>` on the same or previous
 * line is itself reported as an error.
 *
 * Issue: #400
 */

import type { Rule } from 'eslint';

const RULE_NAME = 'chimera/no-fromfloat-in-simulation';

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if `source` looks like an import from the FixedPoint module.
 * Matches:
 *   './FixedPoint'
 *   '../engine/FixedPoint'
 *   '@chimera/simulation/engine/FixedPoint'
 *   './FixedPoint.js'  / './FixedPoint.ts'
 */
function isFixedPointSource(source: string): boolean {
    return /(?:^|\/)FixedPoint(?:\.(?:js|ts))?$/.test(source);
}

/**
 * Returns true if `filename` is inside `simulation/` but NOT inside
 * `simulation/content/loaders/`.
 *
 * Handles both absolute paths and workspace-relative paths, and normalises
 * Windows backslashes.
 */
function isInSimulationNonLoader(filename: string): boolean {
    const n = filename.replace(/\\/g, '/');
    // Must be inside simulation/ (absolute or relative)
    if (!n.includes('/simulation/') && !n.startsWith('simulation/')) return false;
    // Exempt: simulation/content/loaders/**
    if (n.includes('/simulation/content/loaders/') || n.includes('simulation/content/loaders/')) {
        return false;
    }
    return true;
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow fromFloat() from simulation/engine/FixedPoint inside simulation/ hot paths (Invariant #76). Only simulation/content/loaders/** may call fromFloat().',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/400',
        },
        messages: {
            noFromFloat:
                'fromFloat() is forbidden in simulation/ hot paths (Invariant #76). ' +
                'Use fromInt() or fromRatio() for exact conversion. ' +
                'Only simulation/content/loaders/** may call fromFloat().',
            missingChimeraReview:
                '// eslint-disable-next-line chimera/no-fromfloat-in-simulation requires ' +
                'a companion "// @chimera-review: <reason>" comment on the same or previous line.',
        },
        schema: [],
    },

    create(context) {
        // Only run inside simulation/ (excluding loaders).
        if (!isInSimulationNonLoader(context.filename)) {
            return {};
        }

        // Local names bound to fromFloat from a FixedPoint import.
        const fromFloatLocalNames = new Set<string>();

        return {
            ImportDeclaration(node) {
                if (!isFixedPointSource(node.source.value as string)) return;

                for (const specifier of node.specifiers) {
                    if (
                        specifier.type === 'ImportSpecifier' &&
                        specifier.imported.type === 'Identifier' &&
                        specifier.imported.name === 'fromFloat'
                    ) {
                        fromFloatLocalNames.add(specifier.local.name);
                    }
                }
            },

            CallExpression(node) {
                if (node.callee.type !== 'Identifier') return;
                if (!fromFloatLocalNames.has(node.callee.name)) return;
                context.report({ node, messageId: 'noFromFloat' });
            },

            // Secondary: ensure every eslint-disable-next-line for this rule
            // has a companion @chimera-review comment on the same or prior line.
            'Program:exit'(programNode) {
                const sourceCode = context.sourceCode;
                const allComments = sourceCode.ast.comments;

                for (const comment of allComments) {
                    if (comment.type !== 'Line') continue;

                    const text = comment.value.trim();
                    const isDisableComment =
                        text.includes('eslint-disable-next-line') && text.includes(RULE_NAME);
                    if (!isDisableComment) continue;

                    const disableLine = comment.loc!.start.line;

                    const hasCompanion = allComments.some((c) => {
                        if (c.type !== 'Line') return false;
                        const cLine = c.loc!.start.line;
                        if (cLine !== disableLine && cLine !== disableLine - 1) return false;
                        return c.value.trim().startsWith('@chimera-review:');
                    });

                    if (!hasCompanion) {
                        context.report({
                            node: programNode,
                            loc: comment.loc!,
                            messageId: 'missingChimeraReview',
                        });
                    }
                }
            },
        };
    },
};

export default rule;
