'use client';

// renderer/components/debug/JsonTree.tsx
//
// Recursive collapsible JSON tree for the Inspector's Snapshot panel
// (§4.12 — Runtime Debug Layer). Values are JSON-plain debug
// payloads typed `unknown` — the simulation snapshot type is never named in
// the renderer (invariant check 6).
//
// Nodes are button-toggled (`aria-expanded`) rather than `<details>` so the
// expansion state is fully controlled and deterministic under jsdom.
//
// `highlights` maps dot-paths (root `''`, array indices as
// numbers-as-strings) to a highlight kind; a collapsed composite that
// contains a highlighted descendant gets a `data-contains-highlight` marker
// so differences stay visible in collapsed subtrees.

import React, { useMemo, useState } from 'react';
import styles from './JsonTree.module.css';

export type JsonTreeHighlightKind = 'hidden' | 'masked' | 'extra';

export interface JsonTreeProps {
    /** JSON-plain value to render; composites become collapsible nodes. */
    readonly value: unknown;
    /** Key shown for the root node. */
    readonly label?: string;
    /** Nodes shallower than this start expanded; the rest start collapsed. */
    readonly defaultExpandedDepth?: number;
    /** Dot-path → highlight kind; ancestors of a match get a collapsed marker. */
    readonly highlights?: ReadonlyMap<string, JsonTreeHighlightKind> | undefined;
}

type Composite = Record<string, unknown> | readonly unknown[];

const NO_HIGHLIGHTS: ReadonlyMap<string, JsonTreeHighlightKind> = new Map();

function isComposite(value: unknown): value is Composite {
    return typeof value === 'object' && value !== null;
}

function formatLeaf(value: unknown): string {
    if (typeof value === 'string') {
        return `"${value}"`;
    }
    return String(value);
}

function summarize(value: Composite): string {
    return Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
}

function entriesOf(value: Composite): readonly (readonly [string, unknown])[] {
    return Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : Object.entries(value);
}

function ancestorsOf(highlights: ReadonlyMap<string, JsonTreeHighlightKind>): ReadonlySet<string> {
    const ancestors = new Set<string>();
    for (const path of highlights.keys()) {
        let cursor = path;
        while (cursor.includes('.')) {
            cursor = cursor.slice(0, cursor.lastIndexOf('.'));
            ancestors.add(cursor);
        }
        if (path !== '') {
            ancestors.add('');
        }
    }
    return ancestors;
}

export function JsonTree({
    value,
    label = 'root',
    defaultExpandedDepth = 1,
    highlights = NO_HIGHLIGHTS,
}: JsonTreeProps): React.ReactElement {
    const ancestorPaths = useMemo(() => ancestorsOf(highlights), [highlights]);

    return (
        <ul className={styles['tree']} data-testid="json-tree">
            <JsonNode
                ancestorPaths={ancestorPaths}
                defaultExpandedDepth={defaultExpandedDepth}
                depth={0}
                highlights={highlights}
                name={label}
                path=""
                value={value}
            />
        </ul>
    );
}

interface JsonNodeProps {
    readonly name: string;
    readonly value: unknown;
    readonly depth: number;
    readonly defaultExpandedDepth: number;
    /** Dot-path of this node within the root value (root = `''`). */
    readonly path: string;
    readonly highlights: ReadonlyMap<string, JsonTreeHighlightKind>;
    readonly ancestorPaths: ReadonlySet<string>;
}

function JsonNode({
    name,
    value,
    depth,
    defaultExpandedDepth,
    path,
    highlights,
    ancestorPaths,
}: JsonNodeProps): React.ReactElement {
    const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);
    const highlight = highlights.get(path);

    if (!isComposite(value)) {
        return (
            <li className={styles['leaf']} data-highlight={highlight}>
                <span className={styles['key']}>{name}</span>
                <span className={styles['value']}>{formatLeaf(value)}</span>
            </li>
        );
    }

    return (
        <li
            className={styles['node']}
            data-contains-highlight={!expanded && ancestorPaths.has(path) ? 'true' : undefined}
            data-highlight={highlight}
        >
            <button
                aria-expanded={expanded}
                className={styles['toggle']}
                onClick={() => {
                    setExpanded((prev) => !prev);
                }}
                type="button"
            >
                <span className={styles['key']}>{name}</span>
                <span className={styles['summary']}>{summarize(value)}</span>
            </button>
            {expanded ? (
                <ul className={styles['children']}>
                    {entriesOf(value).map(([childName, childValue]) => (
                        <JsonNode
                            ancestorPaths={ancestorPaths}
                            defaultExpandedDepth={defaultExpandedDepth}
                            depth={depth + 1}
                            highlights={highlights}
                            key={childName}
                            name={childName}
                            path={path === '' ? childName : `${path}.${childName}`}
                            value={childValue}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}
