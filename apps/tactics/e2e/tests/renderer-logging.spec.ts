/**
 * Renderer logging bridge E2E coverage.
 *
 * Drives the real chain — renderer console patch → preload logs.emit →
 * main-process schema validation → sink → readRecent — to pin the one
 * property no unit suite can reach: the renderer's field truncation and the
 * `chimera:logs:emit` schema caps agree, for every capped field a page can
 * drive (composed message 4096, error.name 256, error.message 4096,
 * error.stack 8192).
 *
 * `source.module` carries the same 256 cap on both sides but is absent here,
 * because nothing a page can call produces a caller-supplied module: the
 * intercepted console routes always pass the 'global' literal, and
 * `emitRendererError` — the only route that takes a module — is not exposed
 * on `window`. Its two caps are pinned by unit test on each side alone
 * (`rendererLogger.test.ts`, `ipc-schemas.test.ts`), so the coordinated-edit
 * gap described below stays open for that one field.
 *
 * The two sides cannot share a constant across the electron/renderer
 * boundary, so each pins its own literals — `ipc-schemas.test.ts` pins what
 * the schema accepts, `rendererLogger.test.ts` pins what the renderer
 * truncates to — and a *unilateral* edit to either cap does fail that side's
 * unit suite. What fails no unit artifact is a **coordinated** edit: a cap
 * moved together with the literals in its own test, which is exactly what
 * "make the failing test pass" produces, leaving the two sides disagreeing
 * with everything green. This spec is the only artifact that measures the two
 * cap sets against each other: the handler DROPS an entry that fails
 * validation, so a renderer emitting any field the schema rejects makes the
 * probe entry vanish.
 */

import { expect, test as electronTest } from '../fixtures/electron.fixture';
import { MainMenuPage } from '../pages/MainMenuPage';

interface LoggedEntry {
    readonly level: string;
    readonly message: string;
    readonly source: { readonly process: string; readonly module: string };
    readonly error?: { readonly name: string; readonly message: string; readonly stack?: string };
}

electronTest.describe('Renderer logging bridge', () => {
    electronTest(
        'a console.error oversizing every capped field round-trips truncated, not dropped',
        async ({ mainWindow }) => {
            const menu = new MainMenuPage(mainWindow);
            await menu.goto();
            // Page reached the shell at all — not a hydration gate: the static
            // export ships this element in the prerendered HTML, so it is
            // visible before any JS runs.
            await expect(menu.menu).toBeVisible();

            // The console patch installs during LoggingBootstrap's React
            // render, and `goto` resolves at 'load' — which does not guarantee
            // React has committed. Gate on the property the probe below
            // depends on: a console.error actually completing the round trip.
            await expect
                .poll(
                    () =>
                        mainWindow.evaluate(async () => {
                            console.error('[logging-e2e] bridge-ready');
                            const api = (
                                globalThis as unknown as {
                                    __chimera: {
                                        logs: {
                                            readRecent(n: number): Promise<{ message: string }[]>;
                                        };
                                    };
                                }
                            ).__chimera.logs;
                            const recent = await api.readRecent(50);
                            return recent.some((entry) =>
                                entry.message.startsWith('[logging-e2e] bridge-ready'),
                            );
                        }),
                    {
                        timeout: 15_000,
                        message: 'the renderer console patch never reached the main-process sink',
                    },
                )
                .toBe(true);

            await mainWindow.evaluate(() => {
                const err = new Error('m'.repeat(5000));
                err.name = 'N'.repeat(500);
                err.stack = 'x'.repeat(10_000);
                console.error(`[logging-e2e] oversized ${'y'.repeat(5000)}`, err);
            });

            const entries = await mainWindow.evaluate(async () => {
                const api = (
                    globalThis as unknown as {
                        __chimera: {
                            logs: { readRecent(n: number): Promise<unknown[]> };
                        };
                    }
                ).__chimera.logs;
                return api.readRecent(200);
            });

            const probe = (entries as LoggedEntry[]).find((entry) =>
                entry.message.startsWith('[logging-e2e] oversized'),
            );

            expect(
                probe,
                'entry must arrive truncated renderer-side, never be dropped at the schema',
            ).toBeDefined();
            expect(probe?.level).toBe('error');
            expect(probe?.source.process).toBe('renderer');
            // Each field truncated to exactly its shared cap — proves the
            // renderer truncates AND the schema accepts the truncated value.
            // (That the threaded Error leaves the composed message is pinned
            // exactly in rendererLogger.test.ts; it is unobservable here,
            // because the 4096 cap cuts this message either way.)
            expect(probe?.message).toHaveLength(4096);
            expect(probe?.error?.name).toHaveLength(256);
            expect(probe?.error?.message).toHaveLength(4096);
            expect(probe?.error?.stack).toHaveLength(8192);
        },
    );
});
