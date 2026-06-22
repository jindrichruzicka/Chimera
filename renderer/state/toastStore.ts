/**
 * renderer/state/toastStore.ts
 *
 * Renderer-only Zustand store for transient toast notifications.
 *
 * Architecture reference: §4.30 — Toast Notification System
 * Invariant #74: toastStore is renderer-only state.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
    readonly id: string;
    readonly severity: ToastSeverity;
    readonly title: string;
    readonly body?: string;
    readonly durationMs?: number;
    readonly action?: {
        readonly label: string;
        readonly onClick: () => void;
    };
    readonly createdAt: number;
}

export const TOAST_DURATION_MS_BY_SEVERITY = {
    info: 4_000,
    success: 3_000,
    warning: 6_000,
    error: 8_000,
} as const satisfies Record<ToastSeverity, number>;

export interface ToastStore {
    readonly queue: readonly Toast[];
    push(this: void, toast: Omit<Toast, 'id' | 'createdAt'>): void;
    dismiss(this: void, id: string): void;
    dismissAll(this: void): void;
}

export function createToastStore(): StoreApi<ToastStore> {
    return createStore<ToastStore>()((set) => ({
        queue: [],

        push(toast: Omit<Toast, 'id' | 'createdAt'>): void {
            const createdToast: Toast = {
                ...toast,
                id: crypto.randomUUID(),
                durationMs: toast.durationMs ?? TOAST_DURATION_MS_BY_SEVERITY[toast.severity],
                createdAt: performance.now(),
            };

            set((state) => ({ queue: [...state.queue, createdToast] }));
        },

        dismiss(id: string): void {
            set((state) => ({ queue: state.queue.filter((toast) => toast.id !== id) }));
        },

        dismissAll(): void {
            set(() => ({ queue: [] }));
        },
    }));
}

let toastStoreInstance: StoreApi<ToastStore> | undefined;

/**
 * Lazily instantiate the singleton on first access. Importing this module — and
 * the `@chimera/renderer/components/chat` barrel that pulls it through
 * `ChatPanel` — therefore creates no store, keeping that barrel side-effect-free
 * (issue #772, Invariant #96). Behaviour is otherwise identical to an eager
 * module-level singleton: the same instance is returned on every access.
 */
function getToastStore(): StoreApi<ToastStore> {
    return (toastStoreInstance ??= createToastStore());
}

export function useToastStore<TSelected>(selector: (state: ToastStore) => TSelected): TSelected {
    return useStore(getToastStore(), selector);
}

useToastStore.getState = (): ToastStore => getToastStore().getState();
useToastStore.subscribe = ((
    listener: Parameters<StoreApi<ToastStore>['subscribe']>[0],
): (() => void) => getToastStore().subscribe(listener)) as StoreApi<ToastStore>['subscribe'];
