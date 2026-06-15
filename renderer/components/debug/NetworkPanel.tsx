'use client';

// renderer/components/debug/NetworkPanel.tsx
//
// Inspector Network panel (§4.12 — Runtime Debug Layer, F47 T10, #717).
// Surfaces the host's non-internal IPv4 addresses, the active hosted port, a
// hosting badge, copy-to-clipboard affordances, and a static port-forward
// guide so a player hosting a lobby can read off (and copy) the join address
// and forward the right port.
//
// One-shot fetch on mount: connection diagnostics only change when hosting
// starts/stops, which does not happen while this view is open, so — unlike
// PerformancePanel — there is no live-tick subscription. The port-forward
// guide is static renderer copy and is never serialized over IPC.

import React, { useEffect, useState } from 'react';
import type {
    ChimeraDebugApi,
    NetworkDiagnostics,
} from '@chimera/electron/preload/debug-api-types.js';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Caption } from '../ui/Caption';
import { IconButton } from '../ui/IconButton';
import { Spinner } from '../ui/Spinner';
import styles from './NetworkPanel.module.css';

export interface NetworkPanelProps {
    readonly api: ChimeraDebugApi;
}

type DiagnosticsState =
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly diagnostics: NetworkDiagnostics }
    | { readonly kind: 'error'; readonly message: string };

/** Numbered router walkthrough; static renderer copy, never IPC-serialized. */
const PORT_FORWARD_STEPS: readonly string[] = [
    "Open your router's admin page (commonly http://192.168.0.1 or http://192.168.1.1).",
    'Find the Port Forwarding section (sometimes called NAT, Virtual Server, or Applications).',
    "Forward the host port shown above (TCP) to this machine's local IPv4 address.",
    'Save and reboot the router if prompted, then share your address and port with the other player.',
];

function copyToClipboard(value: string): void {
    void navigator.clipboard?.writeText(value);
}

export function NetworkPanel({ api }: NetworkPanelProps): React.ReactElement {
    const [state, setState] = useState<DiagnosticsState>({ kind: 'loading' });

    useEffect(() => {
        let active = true;

        api.getNetworkDiagnostics()
            .then((diagnostics) => {
                if (active) {
                    setState({ kind: 'ready', diagnostics });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({
                        kind: 'error',
                        message:
                            error instanceof Error
                                ? error.message
                                : 'Failed to load network diagnostics',
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [api]);

    return (
        <div className={styles['root']} data-testid="network-panel">
            {state.kind === 'loading' && <Spinner label="Loading network diagnostics" />}

            {state.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {state.message}
                </p>
            )}

            {state.kind === 'ready' && <NetworkReady diagnostics={state.diagnostics} />}
        </div>
    );
}

interface NetworkReadyProps {
    readonly diagnostics: NetworkDiagnostics;
}

function NetworkReady({ diagnostics }: NetworkReadyProps): React.ReactElement {
    const { localAddresses, hostPort, isHosting } = diagnostics;

    return (
        <>
            <div className={styles['header']}>
                <Badge variant={isHosting ? 'success' : 'neutral'}>
                    {isHosting ? 'Hosting' : 'Not hosting'}
                </Badge>
                {hostPort !== null ? (
                    <span className={styles['port']}>
                        <span className={styles['mono']} data-testid="host-port">
                            {hostPort}
                        </span>
                        <IconButton
                            aria-label="Copy host port"
                            onClick={() => copyToClipboard(String(hostPort))}
                        >
                            ⧉
                        </IconButton>
                    </span>
                ) : (
                    <Caption tone="muted">
                        Not hosting — start a lobby to get a join address.
                    </Caption>
                )}
            </div>

            <section className={styles['section']}>
                <Caption tone="muted">Local IPv4 addresses</Caption>
                {localAddresses.length === 0 ? (
                    <Caption tone="muted">No non-internal IPv4 interfaces found.</Caption>
                ) : (
                    <ul className={styles['addressList']} data-testid="network-addresses">
                        {localAddresses.map((address) => {
                            const value = hostPort !== null ? `${address}:${hostPort}` : address;
                            return (
                                <li className={styles['addressRow']} key={address}>
                                    <span className={styles['mono']}>{value}</span>
                                    <IconButton
                                        aria-label={`Copy ${value}`}
                                        onClick={() => copyToClipboard(value)}
                                    >
                                        ⧉
                                    </IconButton>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <PortForwardGuide />
        </>
    );
}

function PortForwardGuide(): React.ReactElement {
    const [expanded, setExpanded] = useState(false);

    return (
        <section className={styles['section']}>
            <Button
                aria-expanded={expanded}
                className={styles['guideToggle']}
                onClick={() => setExpanded((open) => !open)}
                size="sm"
                variant="ghost"
            >
                {expanded ? 'Hide port-forwarding guide' : 'Port-forwarding guide'}
            </Button>
            {expanded && (
                <ol className={styles['guideSteps']} data-testid="port-forward-guide">
                    {PORT_FORWARD_STEPS.map((step) => (
                        <li key={step}>{step}</li>
                    ))}
                </ol>
            )}
        </section>
    );
}
