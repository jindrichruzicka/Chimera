'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TOAST_DURATION_MS_BY_SEVERITY, useToastStore, type Toast } from '../../state/toastStore';
import { Button } from '../ui/Button';
import styles from './ToastHost.module.css';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function resolveToastDurationMs(toast: Toast): number {
    return toast.durationMs ?? TOAST_DURATION_MS_BY_SEVERITY[toast.severity];
}

function usePrefersReducedMotion(): boolean {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') {
            return () => undefined;
        }

        const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
        const updatePreference = (): void => {
            setPrefersReducedMotion(mediaQuery.matches);
        };

        updatePreference();
        mediaQuery.addEventListener('change', updatePreference);

        return () => {
            mediaQuery.removeEventListener('change', updatePreference);
        };
    }, []);

    return prefersReducedMotion;
}

export function ToastHost(): React.ReactElement {
    const queue = useToastStore((state) => state.queue);
    const dismiss = useToastStore((state) => state.dismiss);
    const timeoutIds = useRef(new Map<string, number>());
    const prefersReducedMotion = usePrefersReducedMotion();

    useEffect(() => {
        const activeToastIds = new Set(queue.map((toast) => toast.id));

        for (const [toastId, timeoutId] of timeoutIds.current) {
            if (!activeToastIds.has(toastId)) {
                window.clearTimeout(timeoutId);
                timeoutIds.current.delete(toastId);
            }
        }

        for (const toast of queue) {
            if (timeoutIds.current.has(toast.id)) {
                continue;
            }

            const timeoutId = window.setTimeout(() => {
                timeoutIds.current.delete(toast.id);
                dismiss(toast.id);
            }, resolveToastDurationMs(toast));

            timeoutIds.current.set(toast.id, timeoutId);
        }
    }, [dismiss, queue]);

    useEffect(() => {
        return () => {
            for (const timeoutId of timeoutIds.current.values()) {
                window.clearTimeout(timeoutId);
            }
            timeoutIds.current.clear();
        };
    }, []);

    const hostClassName = [
        styles['host'],
        prefersReducedMotion ? styles['reducedMotion'] : undefined,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <section
            aria-label="Notifications"
            aria-live="polite"
            className={hostClassName}
            data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
            data-testid="toast-host"
        >
            {queue.map((toast) => (
                <ToastItem key={toast.id} toast={toast} />
            ))}
        </section>
    );
}

interface ToastItemProps {
    readonly toast: Toast;
}

function ToastItem({ toast }: ToastItemProps): React.ReactElement {
    const className = [styles['toast'], styles[toast.severity]].filter(Boolean).join(' ');

    return (
        <article
            className={className}
            data-toast-id={toast.id}
            data-toast-severity={toast.severity}
            role="status"
        >
            <div className={styles['copy']}>
                <strong className={styles['title']} data-testid="toast-title">
                    {toast.title}
                </strong>
                {toast.body ? <p className={styles['body']}>{toast.body}</p> : null}
            </div>
            {toast.action ? (
                <div className={styles['actions']}>
                    <Button onClick={toast.action.onClick} size="sm" variant="secondary">
                        {toast.action.label}
                    </Button>
                </div>
            ) : null}
        </article>
    );
}
