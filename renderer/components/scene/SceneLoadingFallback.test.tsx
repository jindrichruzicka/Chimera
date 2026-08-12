// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    GameLoadingScreen,
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
    SceneLoadingReason,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { createRecordingLogsApi } from '../../logging/__test-support__/RecordingLogsApi.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';

const DEFAULT_COVER_HTML = '<div data-testid="scene-screen-loading"></div>';

const Playfield = (_props: GameScreenProps): null => null;

interface RenderOptions {
    readonly screenKey?: string;
    readonly sceneId?: string;
    readonly reason?: SceneLoadingReason;
    readonly progress?: number | null;
    readonly gameOverride?: Readonly<Record<string, string>>;
}

function makeRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
    return { playfield: Playfield, ...overrides };
}

/**
 * Mirrors the production mount: `GameShell` wraps the whole scene in
 * `<React.Suspense fallback={null}>` (GameShell.tsx), so a cover that suspends
 * without its own nested boundary blanks the canvas instead of covering it.
 */
function renderFallback(
    registry: GameScreenRegistry,
    options: RenderOptions = {},
): ReturnType<typeof render> {
    const {
        screenKey = 'playfield',
        sceneId = 'engine:game',
        reason = 'code',
        progress = null,
        gameOverride,
    } = options;

    return render(
        <I18nProvider {...(gameOverride === undefined ? {} : { gameOverride })}>
            <React.Suspense fallback={null}>
                <SceneLoadingFallback
                    registry={registry}
                    screenKey={screenKey}
                    sceneId={sceneId}
                    reason={reason}
                    progress={progress}
                />
            </React.Suspense>
        </I18nProvider>,
    );
}

function makeRecordingCover(testId: string): {
    readonly Cover: (props: GameLoadingScreenProps) => React.ReactElement;
    readonly calls: GameLoadingScreenProps[];
} {
    const calls: GameLoadingScreenProps[] = [];
    return {
        calls,
        Cover: (props: GameLoadingScreenProps): React.ReactElement => {
            calls.push(props);
            return <div data-testid={testId} />;
        },
    };
}

afterEach(() => {
    cleanup();
    delete (globalThis as Record<string, unknown>)['__chimera'];
});

describe('SceneLoadingFallback — the default is exactly nothing', () => {
    it('renders only the scene-screen-loading div when the registry declares neither slot', () => {
        const { container } = renderFallback(makeRegistry());

        // Child COUNT, not a null queryByTestId: the guarantee is that a game
        // declaring no slot gets today's rendering byte for byte — no spinner,
        // no wrapper, no absolutely positioned scrim.
        expect(container.childElementCount).toBe(1);
        expect(container.innerHTML).toBe(DEFAULT_COVER_HTML);
    });

    it("renders only the default cover when the key is opted out with 'none'", () => {
        const { container } = renderFallback(
            makeRegistry({ loadingScreen: 'spinner', loadingScreens: { playfield: 'none' } }),
        );

        expect(container.innerHTML).toBe(DEFAULT_COVER_HTML);
    });
});

describe('SceneLoadingFallback — engine presets', () => {
    it("renders 'spinner' as a status element in the accessibility tree with the engine label", () => {
        renderFallback(makeRegistry({ loadingScreen: 'spinner' }));

        // DEFAULT options (hidden: false): a cover nested inside something
        // aria-hidden would still be found by { hidden: true }, so the default
        // query is the assertion that the wait is announced.
        const status = screen.getByRole('status');
        expect(status.getAttribute('aria-label')).toBe('Loading…');
    });

    it("renders 'progress' as a bar carrying the fraction", () => {
        renderFallback(makeRegistry({ loadingScreen: 'progress' }), { progress: 0.25 });

        const bar = screen.getByRole('progressbar');
        expect(bar.getAttribute('aria-valuenow')).toBe('0.25');
        expect(bar.getAttribute('aria-valuemax')).toBe('1');
        expect(bar.getAttribute('aria-label')).toBe('Loading…');
        expect(screen.queryByRole('status')).toBeNull();
    });

    it("degrades 'progress' to the spinner while the wait is unmeasured", () => {
        renderFallback(makeRegistry({ loadingScreen: 'progress' }), { progress: null });

        expect(screen.getByRole('status')).toBeTruthy();
        // A bar reading 0% for something nobody counted is a claim the engine
        // does not author on a game's behalf.
        expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('renders a { message } cover through the active-locale translator', () => {
        renderFallback(makeRegistry({ loadingScreen: { message: 'game.loading.custom' } }), {
            gameOverride: { 'game.loading.custom': 'Warming up the reactor' },
        });

        expect(screen.getByText('Warming up the reactor')).toBeTruthy();
    });

    it('renders an unregistered { message } string verbatim', () => {
        // `t` returns an unknown key unchanged (translation-bundle.ts), so a
        // literal needs no second code path — pinned rather than assumed.
        renderFallback(makeRegistry({ loadingScreen: { message: 'Almost there' } }));

        expect(screen.getByText('Almost there')).toBeTruthy();
    });

    it('renders an { image } cover with the given src and the engine label as default alt', () => {
        renderFallback(makeRegistry({ loadingScreen: { image: 'chimera://game/loading.png' } }));

        const image = screen.getByRole('img');
        expect(image.getAttribute('src')).toBe('chimera://game/loading.png');
        expect(image.getAttribute('alt')).toBe('Loading…');
    });

    it('prefers an { image } cover’s own alt over the engine label', () => {
        renderFallback(
            makeRegistry({
                loadingScreen: { image: 'chimera://game/loading.png', alt: 'Deploying troops' },
            }),
        );

        expect(screen.getByRole('img').getAttribute('alt')).toBe('Deploying troops');
    });

    it('positions engine presets as a centred, click-through absolute layer', () => {
        renderFallback(makeRegistry({ loadingScreen: 'spinner' }));

        const preset = screen.getByTestId('scene-loading-preset');
        // The declared values, one assertion each — jsdom lays nothing out, so
        // these pin what the module emits, not the resulting box. Each matters:
        // absolute + inset inside the already-relative game-canvas section keeps
        // the cover from growing the canvas grid row and pushing the HUD down,
        // and pointer-events keeps it from eating clicks.
        expect(preset.style.position).toBe('absolute');
        expect(preset.style.inset).toBe('0px');
        expect(preset.style.display).toBe('grid');
        expect(preset.style.placeItems).toBe('center');
        expect(preset.style.pointerEvents).toBe('none');
    });
});

describe('SceneLoadingFallback — union narrowing order', () => {
    it('renders a plain function component cover', () => {
        const { Cover } = makeRecordingCover('game-cover');
        renderFallback(makeRegistry({ loadingScreen: Cover }));

        expect(screen.getByTestId('game-cover')).toBeTruthy();
    });

    it('renders a React.lazy component cover', async () => {
        // React.lazy returns an OBJECT: narrowing components with
        // `typeof cover === 'function'` sends this one down a static-form branch
        // and nothing game-supplied ever renders.
        const { Cover } = makeRecordingCover('lazy-cover');
        const Lazy = React.lazy(() => Promise.resolve({ default: Cover }));

        renderFallback(makeRegistry({ loadingScreen: Lazy }));

        expect(await screen.findByTestId('lazy-cover')).toBeTruthy();
    });

    it('sends each form down its own branch', async () => {
        const { Cover } = makeRecordingCover('plain-cover');
        const Lazy = React.lazy(() => Promise.resolve({ default: Cover }));
        const cases: readonly (readonly [GameLoadingScreen, () => void])[] = [
            ['none', (): void => expect(screen.getByTestId('scene-screen-loading')).toBeTruthy()],
            ['spinner', (): void => expect(screen.getByRole('status')).toBeTruthy()],
            ['progress', (): void => expect(screen.getByRole('progressbar')).toBeTruthy()],
            [
                { message: 'Loading the map' },
                (): void => expect(screen.getByText('Loading the map')).toBeTruthy(),
            ],
            [
                { image: 'chimera://game/loading.png' },
                (): void => expect(screen.getByRole('img')).toBeTruthy(),
            ],
            [Cover, (): void => expect(screen.getByTestId('plain-cover')).toBeTruthy()],
        ];

        for (const [form, assertBranch] of cases) {
            renderFallback(makeRegistry({ loadingScreen: form }), { progress: 0.5 });
            assertBranch();
            cleanup();
        }

        renderFallback(makeRegistry({ loadingScreen: Lazy }), { progress: 0.5 });
        expect(await screen.findByTestId('plain-cover')).toBeTruthy();
    });
});

describe('SceneLoadingFallback — a broken cover degrades, never escalates', () => {
    it('renders the default cover while a lazy cover chunk never resolves', () => {
        // Without the nested <React.Suspense>, the suspension bubbles to
        // GameShell's outer `fallback={null}` and blanks the whole scene — the
        // exact opposite of what a cover is for.
        const NeverResolves = React.lazy(
            () => new Promise<{ default: React.ComponentType<GameLoadingScreenProps> }>(() => {}),
        );

        const { container } = renderFallback(makeRegistry({ loadingScreen: NeverResolves }));

        expect(container.innerHTML).toBe(DEFAULT_COVER_HTML);
    });

    it('degrades a throwing cover to the default cover and reports it once', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const logs = createRecordingLogsApi();
        (globalThis as Record<string, unknown>)['__chimera'] = { logs };
        const Bomb = (_props: GameLoadingScreenProps): React.ReactElement => {
            throw new Error('cover explosion');
        };

        // No cover is a cosmetic loss; no game is not — the throw must not reach
        // GameShell's boundary.
        expect(() => renderFallback(makeRegistry({ loadingScreen: Bomb }))).not.toThrow();

        expect(screen.getByTestId('scene-screen-loading')).toBeTruthy();
        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.level).toBe('error');
        expect(logs.emitCalls[0]?.error?.message).toBe('cover explosion');
        consoleError.mockRestore();
    });
});

describe('SceneLoadingFallback — props delivered to a game cover', () => {
    let recorder: ReturnType<typeof makeRecordingCover>;

    beforeEach(() => {
        recorder = makeRecordingCover('game-cover');
    });

    it("carries a null progress for reason 'code' — never 0", () => {
        renderFallback(makeRegistry({ loadingScreen: recorder.Cover }), {
            reason: 'code',
            progress: null,
        });

        expect(recorder.calls[0]?.reason).toBe('code');
        expect(recorder.calls[0]?.progress).toBeNull();
    });

    it("carries the settled fraction for reason 'assets'", () => {
        renderFallback(makeRegistry({ loadingScreen: recorder.Cover }), {
            reason: 'assets',
            progress: 0.4,
        });

        expect(recorder.calls[0]?.reason).toBe('assets');
        expect(recorder.calls[0]?.progress).toBe(0.4);
    });

    it('carries the resolved screen key', () => {
        renderFallback(makeRegistry({ loadingScreens: { 'tech-tree': recorder.Cover } }), {
            screenKey: 'tech-tree',
        });

        expect(recorder.calls[0]?.screenKey).toBe('tech-tree');
    });

    it('carries the scene the cover is shown inside', () => {
        renderFallback(makeRegistry({ loadingScreen: recorder.Cover }), {
            sceneId: 'engine:post-game',
        });

        expect(recorder.calls[0]?.sceneId).toBe('engine:post-game');
    });
});
