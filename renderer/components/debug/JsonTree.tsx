'use client';

// renderer/components/debug/JsonTree.tsx
//
// Recursive collapsible JSON tree for the Inspector's Snapshot panel
// (§4.12 — Runtime Debug Layer, F47 T8, #697). Values are JSON-plain debug
// payloads typed `unknown` — the simulation snapshot type is never named in
// the renderer (invariant check 6).
//
// Nodes are button-toggled (`aria-expanded`) rather than `<details>` so the
// expansion state is fully controlled and deterministic under jsdom.

import React, { useState } from 'react';
import styles from './JsonTree.module.css';

export interface JsonTreeProps {
    /** JSON-plain value to render; composites become collapsible nodes. */
    readonly value: unknown;
    /** Key shown for the root node. */
    readonly label?: string;
    /** Nodes shallower than this start expanded; the rest start collapsed. */
    readonly defaultExpandedDepth?: number;
}

type Composite = Record<string, unknown> | readonly unknown[];

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

export function JsonTree({
    value,
    label = 'root',
    defaultExpandedDepth = 1,
}: JsonTreeProps): React.ReactElement {
    return (
        <ul className={styles['tree']} data-testid="json-tree">
            <JsonNode
                defaultExpandedDepth={defaultExpandedDepth}
                depth={0}
                name={label}
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
}

function JsonNode({ name, value, depth, defaultExpandedDepth }: JsonNodeProps): React.ReactElement {
    const [expanded, setExpanded] = useState(depth < defaultExpandedDepth);

    if (!isComposite(value)) {
        return (
            <li className={styles['leaf']}>
                <span className={styles['key']}>{name}</span>
                <span className={styles['value']}>{formatLeaf(value)}</span>
            </li>
        );
    }

    return (
        <li className={styles['node']}>
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
                            defaultExpandedDepth={defaultExpandedDepth}
                            depth={depth + 1}
                            key={childName}
                            name={childName}
                            value={childValue}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}
