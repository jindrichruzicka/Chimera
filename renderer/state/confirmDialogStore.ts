/**
 * renderer/state/confirmDialogStore.ts
 *
 * Renderer-only Zustand store behind the single engine confirm surface: the
 * promise-resolving queue that `ConfirmDialogHost` renders and
 * `useConfirmDialog()` writes to.
 *
 * `request()` appends an entry and hands back a promise that settles when the
 * player answers; `settle()` is called by the host. Only the head of the queue
 * is ever displayed — one confirm surface, one visible question — so a second
 * request made while one is open waits its turn instead of being silently
 * dropped or stealing the dialog from under the player.
 *
 * The resolvers live in the factory closure rather than in store state: state is
 * read by React through selectors, and a resolver is neither renderable nor
 * comparable.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

// ── Store shape ───────────────────────────────────────────────────────────────

/** What a caller asks. Every field is a display string (or translation token). */
export interface ConfirmDialogOptions {
    /** Dialog heading. */
    readonly title: string;
    /** Optional explanatory paragraph under the heading. */
    readonly body?: string;
    /** Label for the accepting button; the engine default applies when omitted. */
    readonly confirmLabel?: string;
    /** Label for the dismissing button; the engine default applies when omitted. */
    readonly cancelLabel?: string;
}

/** A queued question, identified so the host can settle exactly this one. */
export interface ConfirmDialogRequest extends ConfirmDialogOptions {
    readonly id: string;
}

export interface ConfirmDialogStore {
    /** Outstanding questions in ask order. Only `queue[0]` is displayed. */
    readonly queue: readonly ConfirmDialogRequest[];

    /**
     * Ask a question. Resolves `true` when the player accepts and `false` when
     * they decline (including Escape and a backdrop-level dismiss).
     */
    request(this: void, options: ConfirmDialogOptions): Promise<boolean>;

    /**
     * Answer the request with the given id. Host only — components ask through
     * `useConfirmDialog()` and never settle their own question.
     *
     * An unknown id (already settled, or never queued) is a no-op, so a late
     * second answer from a closing dialog cannot re-resolve a settled promise.
     */
    settle(this: void, id: string, accepted: boolean): void;
}

// ── Factory (for testing and production use) ──────────────────────────────────

/**
 * Create an isolated store instance. Preferred for tests so each test has an
 * independent queue that does not share state with the singleton.
 */
export function createConfirmDialogStore(): StoreApi<ConfirmDialogStore> {
    const resolvers = new Map<string, (accepted: boolean) => void>();

    return createStore<ConfirmDialogStore>()((set) => ({
        queue: [],

        request(options: ConfirmDialogOptions): Promise<boolean> {
            const id = crypto.randomUUID();
            const entry: ConfirmDialogRequest = { ...options, id };

            return new Promise<boolean>((resolve) => {
                resolvers.set(id, resolve);
                set((state) => ({ queue: [...state.queue, entry] }));
            });
        },

        settle(id: string, accepted: boolean): void {
            const resolve = resolvers.get(id);
            if (resolve === undefined) return;

            resolvers.delete(id);
            set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) }));
            resolve(accepted);
        },
    }));
}

// ── Singleton (lazy) ──────────────────────────────────────────────────────────

let confirmDialogStoreInstance: StoreApi<ConfirmDialogStore> | undefined;

/**
 * Lazily instantiate the singleton on first access, so importing this module —
 * and the `@chimera-engine/renderer/components/ui` barrel that pulls it through
 * `ConfirmDialog` — creates no store and keeps that barrel side-effect-free
 * (Invariant #96).
 */
function getConfirmDialogStore(): StoreApi<ConfirmDialogStore> {
    return (confirmDialogStoreInstance ??= createConfirmDialogStore());
}

/**
 * Zustand hook for the confirm store. Always subscribe via a narrow selector:
 *
 * ```typescript
 * const pending = useConfirmDialogStore(selectPendingConfirm);
 * ```
 */
export function useConfirmDialogStore<TSelected>(
    selector: (state: ConfirmDialogStore) => TSelected,
): TSelected {
    return useStore(getConfirmDialogStore(), selector);
}

useConfirmDialogStore.getState = (): ConfirmDialogStore => getConfirmDialogStore().getState();
useConfirmDialogStore.subscribe = ((
    listener: Parameters<StoreApi<ConfirmDialogStore>['subscribe']>[0],
): (() => void) =>
    getConfirmDialogStore().subscribe(listener)) as StoreApi<ConfirmDialogStore>['subscribe'];

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * The one question currently on screen, or `null` while the queue is empty.
 * Referentially stable: it returns the queue entry itself, so a re-render with
 * an unchanged head compares equal.
 */
export function selectPendingConfirm(state: ConfirmDialogStore): ConfirmDialogRequest | null {
    return state.queue[0] ?? null;
}
